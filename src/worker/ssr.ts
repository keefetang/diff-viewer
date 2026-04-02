/**
 * Server-side rendering for `/:id` session routes.
 *
 * Fetches the session from KV, computes diff stats using @codemirror/merge,
 * and uses HTMLRewriter to inject OG meta tags, unified diff text, and
 * bootstrap data into the SPA shell. Crawlers see full content; the SPA
 * boots from injected data without a redundant API fetch.
 */

import { Text as CMText } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { NonceInjector } from './security';
import { escapeForHtml, escapeText } from './shared';
import type { DiffSessionValue, SessionMetadata } from './shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  ASSETS: Fetcher;
  SESSIONS: KVNamespace;
  CF_ANALYTICS_TOKEN?: string;
  TURNSTILE_SITE_KEY?: string;
}

interface BootstrapData {
  id: string;
  original: string;
  modified: string;
  title?: string;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

interface DiffStats {
  additions: number;
  deletions: number;
  chunks: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute diff stats and unified diff text from original/modified strings.
 *
 * Uses @codemirror/merge's Chunk.build() which works in non-browser
 * environments. The chunks describe changed regions by character position;
 * we convert these to line-based unified diff format.
 */
function computeDiff(original: string, modified: string): {
  stats: DiffStats;
  unifiedDiff: string;
} {
  const linesA = original.split('\n');
  const linesB = modified.split('\n');
  const textA = CMText.of(linesA.length === 0 ? [''] : linesA);
  const textB = CMText.of(linesB.length === 0 ? [''] : linesB);

  const chunks = Chunk.build(textA, textB, { scanLimit: 500 });

  if (chunks.length === 0) {
    return {
      stats: { additions: 0, deletions: 0, chunks: 0 },
      unifiedDiff: '--- original\n+++ modified\n',
    };
  }

  let additions = 0;
  let deletions = 0;
  const CONTEXT_LINES = 3;
  const hunks: string[] = [];

  for (const chunk of chunks) {
    // Convert character positions to 1-based line numbers.
    // lineAt() returns the line containing the position.
    const startLineA = textA.lineAt(chunk.fromA).number;
    const endLineA = chunk.fromA === chunk.toA
      ? startLineA - 1  // empty on A side (pure insertion)
      : textA.lineAt(Math.min(chunk.toA - 1, textA.length - 1)).number;

    const startLineB = textB.lineAt(chunk.fromB).number;
    const endLineB = chunk.fromB === chunk.toB
      ? startLineB - 1  // empty on B side (pure deletion)
      : textB.lineAt(Math.min(chunk.toB - 1, textB.length - 1)).number;

    const deletedCount = Math.max(0, endLineA - startLineA + 1);
    const addedCount = Math.max(0, endLineB - startLineB + 1);

    additions += addedCount;
    deletions += deletedCount;

    // Context lines before the chunk
    const ctxStart = Math.max(1, startLineA - CONTEXT_LINES);
    const ctxStartB = Math.max(1, startLineB - CONTEXT_LINES);

    // Context lines after the chunk
    const ctxEndA = Math.min(textA.lines, (endLineA >= startLineA ? endLineA : startLineA - 1) + CONTEXT_LINES);
    const ctxEndB = Math.min(textB.lines, (endLineB >= startLineB ? endLineB : startLineB - 1) + CONTEXT_LINES);

    const hunkLinesA = ctxEndA - ctxStart + 1;
    const hunkLinesB = ctxEndB - ctxStartB + 1;

    const hunkLines: string[] = [];
    hunkLines.push(`@@ -${ctxStart},${hunkLinesA} +${ctxStartB},${hunkLinesB} @@`);

    // Context before
    for (let i = ctxStart; i < startLineA && i <= textA.lines; i++) {
      hunkLines.push(` ${textA.line(i).text}`);
    }

    // Deleted lines from A
    for (let i = startLineA; i <= endLineA && i <= textA.lines; i++) {
      hunkLines.push(`-${textA.line(i).text}`);
    }

    // Added lines from B
    for (let i = startLineB; i <= endLineB && i <= textB.lines; i++) {
      hunkLines.push(`+${textB.line(i).text}`);
    }

    // Context after
    const afterStartA = (endLineA >= startLineA ? endLineA : startLineA - 1) + 1;
    for (let i = afterStartA; i <= ctxEndA && i <= textA.lines; i++) {
      hunkLines.push(` ${textA.line(i).text}`);
    }

    hunks.push(hunkLines.join('\n'));
  }

  const header = '--- original\n+++ modified';
  const unifiedDiff = `${header}\n${hunks.join('\n')}`;

  return {
    stats: { additions, deletions, chunks: chunks.length },
    unifiedDiff,
  };
}

// ---------------------------------------------------------------------------
// HTMLRewriter element handlers
// ---------------------------------------------------------------------------

/** Replaces the inner text of a <title> element. */
class TitleHandler implements HTMLRewriterElementContentHandlers {
  private readonly title: string;
  private replaced = false;

  constructor(title: string) {
    this.title = title;
  }

  text(text: { replace(s: string, options?: { html?: boolean }): void; remove(): void }): void {
    if (!this.replaced) {
      text.replace(escapeText(this.title));
      this.replaced = true;
    } else {
      text.remove();
    }
  }
}

/** Appends OG meta tags to <head>. */
class HeadHandler implements HTMLRewriterElementContentHandlers {
  private readonly tags: string;

  constructor(tags: string) {
    this.tags = tags;
  }

  element(el: Element): void {
    el.append(this.tags, { html: true });
  }
}

/** Injects unified diff text into the #content div. */
class ContentHandler implements HTMLRewriterElementContentHandlers {
  private readonly html: string;

  constructor(html: string) {
    this.html = html;
  }

  element(el: Element): void {
    el.append(this.html, { html: true });
  }
}

/** Appends scripts/data before </body>. */
class BodyHandler implements HTMLRewriterElementContentHandlers {
  private readonly snippets: string[];

  constructor(snippets: string[]) {
    this.snippets = snippets;
  }

  element(el: Element): void {
    for (const snippet of this.snippets) {
      el.append(snippet, { html: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Main SSR handler
// ---------------------------------------------------------------------------

/**
 * Handle a `/:id` session route with server-side rendering.
 *
 * - Fetches session from KV
 * - Not found → 302 redirect to `/`
 * - Found → computes diff, injects OG tags + unified diff + bootstrap data
 *   into the SPA shell via HTMLRewriter
 *
 * @param nonce - Per-request CSP nonce for script tags.
 */
export async function handleSession(request: Request, env: Env, nonce: string): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.slice(1); // strip leading `/`

  // Fetch session from KV.
  // On KV error: serve the bare SPA shell (no bootstrap data). The client
  // will retry via API fetch and show an error in the UI — better than a
  // raw JSON 500 response.
  // On 404: redirect to `/`.
  let rawValue: string | null = null;
  let metadata: SessionMetadata | null = null;
  let kvError = false;
  try {
    const result = await env.SESSIONS.getWithMetadata<SessionMetadata>(id);
    rawValue = result.value;
    metadata = result.metadata;
  } catch {
    kvError = true;
  }

  if (!kvError && (rawValue === null || metadata === null)) {
    // Session genuinely not found — redirect to home
    return Response.redirect(`${url.origin}/`, 302);
  }

  if (kvError) {
    // KV unavailable — serve the SPA shell without SSR content.
    // The client boots, sees it's on /:id, tries the API, and handles the error.
    const shellResponse = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`));
    return new HTMLRewriter()
      .on('script', new NonceInjector(nonce))
      .transform(shellResponse);
  }

  // Parse KV value — the stored JSON is `DiffSessionValue`
  let session: DiffSessionValue;
  try {
    session = JSON.parse(rawValue!) as DiffSessionValue;
  } catch {
    // Corrupted data — redirect to home
    return Response.redirect(`${url.origin}/`, 302);
  }

  // Compute diff stats and unified diff text
  const { stats, unifiedDiff } = computeDiff(session.original, session.modified);

  // Build SEO data
  const pageTitle = session.title
    ? session.title
    : `Diff: +${stats.additions} −${stats.deletions} lines`;
  const description = `${stats.additions} additions, ${stats.deletions} deletions across ${stats.chunks} changed regions`;
  const fullUrl = url.href;

  // Build bootstrap data (NO editToken — tokens come from URL hash or localStorage)
  const bootstrapData: BootstrapData = {
    id,
    original: session.original,
    modified: session.modified,
    title: session.title,
    metadata: {
      createdAt: metadata!.createdAt,
      updatedAt: metadata!.updatedAt,
    },
  };

  // CRITICAL: Escape ALL `<` to prevent </script> injection attacks
  const safeJson = JSON.stringify(bootstrapData).replace(/</g, '\\u003c');

  // Build OG meta tags
  const escapedTitle = escapeForHtml(pageTitle);
  const escapedDesc = escapeForHtml(description);
  const escapedUrl = escapeForHtml(fullUrl);

  // Build head tags: OG meta + Turnstile site key (matches handleAssets placement in <head>)
  const headTags: string[] = [
    `<meta property="og:title" content="${escapedTitle}" />`,
    `<meta property="og:description" content="${escapedDesc}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:url" content="${escapedUrl}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapedTitle}" />`,
    `<meta name="twitter:description" content="${escapedDesc}" />`,
  ];

  if (env.TURNSTILE_SITE_KEY) {
    const siteKey = escapeForHtml(env.TURNSTILE_SITE_KEY);
    headTags.push(`<script nonce="${nonce}">window.__TURNSTILE_KEY__="${siteKey}";</script>`);
  }

  // Build body snippets: bootstrap data + optional analytics beacon.
  // Nonces are added inline here AND via NonceInjector on existing <script> tags.
  const bodySnippets: string[] = [
    `<script nonce="${nonce}" type="application/json" id="__DATA__">${safeJson}</script>`,
  ];

  if (env.CF_ANALYTICS_TOKEN) {
    const token = escapeForHtml(env.CF_ANALYTICS_TOKEN);
    bodySnippets.push(
      `<script nonce="${nonce}" defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${token}"}'></script>`,
    );
  }

  // Build the content div HTML — unified diff in a <pre> for crawlers
  const contentHtml = `<pre>${escapeText(unifiedDiff)}</pre>`;

  // Fetch the SPA shell from static assets
  const shellResponse = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`));

  // Apply HTMLRewriter transformations.
  // NonceInjector adds `nonce` to ALL <script> tags (existing Vite module scripts
  // in the SPA shell). Appended scripts already have nonces inline above.
  const fullTitle = `${pageTitle} — Diff Viewer`;
  const rewriter = new HTMLRewriter()
    .on('script', new NonceInjector(nonce))
    .on('title', new TitleHandler(fullTitle))
    .on('head', new HeadHandler(headTags.join('\n')))
    .on('div#content', new ContentHandler(contentHtml))
    .on('body', new BodyHandler(bodySnippets));

  const response = rewriter.transform(shellResponse);

  // Add headers — prevent search indexing of user content
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Content-Type', 'text/html; charset=utf-8');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
