import { handleApi, handleCorsPreflight } from './api';
import { getIndexHtml, getIndexMarkdown } from './index-content';
import { applySecurityHeaders, NonceInjector } from './security';
import { handleSession, computeDiff } from './ssr';
import { escapeForHtml, timingSafeEqual, sessionHeaders, checkIfNoneMatch } from './shared';
import type { DiffSessionValue, SessionMetadata } from './shared';

interface Env {
  ASSETS: Fetcher;
  SESSIONS: KVNamespace;
  // Rate limiting is optional — the Deploy to Cloudflare button may not
  // auto-provision rate limit bindings. When absent, the app functions
  // without rate limiting (Turnstile + edit tokens are the primary defenses).
  WRITE_LIMITER?: RateLimit;
  READ_LIMITER?: RateLimit;
  CF_ANALYTICS_TOKEN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CORS_ORIGIN?: string;
}

const SESSION_ID_RE = /^\/[A-Za-z0-9_-]{12}$/;

// ---- Content Negotiation ----

function wantsMarkdown(request: Request): boolean {
  const accept = request.headers.get('Accept') || '';
  // Match explicit text/markdown requests (CLI tools, programmatic clients).
  // Exclude browsers — they always send text/html in their Accept header.
  return accept.includes('text/markdown') && !accept.includes('text/html');
}

/**
 * Return unified diff for a session via content negotiation.
 * Public sessions are readable by anyone — the content is already visible
 * via the UI. Private sessions require `X-Edit-Token`. Never exposes editToken.
 */
async function handleDiffContent(request: Request, env: Env, sessionId: string): Promise<Response> {
  const { value: content, metadata } =
    await env.SESSIONS.getWithMetadata<SessionMetadata>(sessionId);

  if (content === null || metadata === null) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Private sessions require a valid edit token — 404 to avoid revealing existence
  if (metadata.private) {
    const editTokenHeader = request.headers.get('X-Edit-Token');
    if (!editTokenHeader || !timingSafeEqual(editTokenHeader, metadata.editToken)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  // Conditional retrieval — 304 when client already has current version.
  // Checked after auth so private sessions don't leak existence via 304.
  if (checkIfNoneMatch(request, metadata.updatedAt)) {
    return new Response(null, {
      status: 304,
      headers: sessionHeaders(metadata),
    });
  }

  let session: DiffSessionValue;
  try {
    session = JSON.parse(content) as DiffSessionValue;
  } catch {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const { unifiedDiff } = computeDiff(session.original, session.modified);

  // X-Robots-Tag and Cache-Control added by applySecurityHeaders (isApi=true)
  return new Response(unifiedDiff, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...sessionHeaders(metadata),
    },
  });
}

// ---- Router ----

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // API routes — handle CORS preflight at the router level
      if (pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
          return handleCorsPreflight(env);
        }

        const apiResponse = await handleApi(request, env);
        return applySecurityHeaders(apiResponse, true);
      }

      // robots.txt — plain text, no security headers needed
      if (pathname === '/robots.txt') {
        return handleRobotsTxt();
      }

      // Content negotiation — Accept: text/markdown or ?format=diff returns
      // raw content. ?format=diff is the URL-friendly alternative for contexts
      // where you can't control headers (browser address bar, links, docs).
      // Wrapped with applySecurityHeaders (isApi=true) for consistent
      // security posture (HSTS, nosniff, noindex, etc.).
      const format = url.searchParams.get('format');

      if (wantsMarkdown(request) || format === 'diff') {
        if (pathname === '/') {
          const mdResponse = new Response(getIndexMarkdown(), {
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
          });
          return applySecurityHeaders(mdResponse, true);
        }
        if (SESSION_ID_RE.test(pathname)) {
          const diffResponse = await handleDiffContent(request, env, pathname.slice(1));
          return applySecurityHeaders(diffResponse, true);
        }
      }

      // Session ID route — SSR with OG tags + unified diff + bootstrap data
      if (SESSION_ID_RE.test(pathname)) {
        const nonce = crypto.randomUUID();
        const ssrResponse = await handleSession(request, env, nonce);
        return applySecurityHeaders(ssrResponse, false, nonce);
      }

      // Everything else — serve static assets with config injection.
      // For `/`, also injects SEO content and OG meta tags.
      const nonce = crypto.randomUUID();
      const assetResponse = await handleAssets(request, env, url, nonce);
      return applySecurityHeaders(assetResponse, false, nonce);
    } catch (err) {
      console.error(JSON.stringify({
        message: 'unhandled error',
        error: err instanceof Error ? err.message : String(err),
        path: pathname,
      }));
      const errorRes = new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
      return applySecurityHeaders(errorRes, true);
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

function handleRobotsTxt(): Response {
  // Only the front page is indexable. Everything else — session content,
  // API, assets — is disallowed. X-Robots-Tag: noindex on SSR responses
  // is the belt; this is the suspenders.
  const body = [
    'User-agent: *',
    'Allow: /$',
    'Disallow: /',
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// ---------------------------------------------------------------------------
// Static assets + SEO
// ---------------------------------------------------------------------------

async function handleAssets(request: Request, env: Env, url: URL, nonce: string): Promise<Response> {
  // Note: /assets/* requests are served directly by Workers Static Assets
  // (excluded via run_worker_first in wrangler.jsonc). Cache headers for
  // hashed Vite output are set via the _headers file in public/.
  const response = await env.ASSETS.fetch(request);

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  const isIndex = url.pathname === '/';

  // Inject runtime config into HTML responses via HTMLRewriter.
  // NonceInjector adds `nonce` to ALL <script> tags (existing + appended),
  // enabling CSP nonce-based trust. Cloudflare's edge reads the nonce from
  // our CSP header and applies it to its own injected scripts too.
  let rewriter = new HTMLRewriter()
    .on('script', new NonceInjector(nonce));

  // Index page — inject OG meta tags and SEO content for crawlers.
  // #content { display: none } in the CSS bundle prevents flash for browser
  // users; crawlers parsing raw HTML (no CSS) see the content.
  if (isIndex) {
    const indexUrl = escapeForHtml(url.origin + '/');
    rewriter = rewriter
      .on('head', {
        element(el) {
          // Indent each tag to match <head> children (4 spaces).
          el.append(
            '\n    ' + [
              `<meta property="og:title" content="Diff Viewer" />`,
              `<meta property="og:description" content="A fast, privacy-first text diff tool. Paste two texts, see a live diff with line and character-level highlights, and share via URL." />`,
              `<meta property="og:type" content="website" />`,
              `<meta property="og:url" content="${indexUrl}" />`,
              `<meta name="twitter:card" content="summary" />`,
            ].join('\n    '),
            { html: true },
          );
        },
      })
      .on('div#content', {
        element(el) {
          el.setInnerContent(`\n      ${getIndexHtml().replace(/\n/g, '\n      ')}\n    `, { html: true });
        },
      });
  }

  if (env.CF_ANALYTICS_TOKEN) {
    const token = escapeForHtml(env.CF_ANALYTICS_TOKEN);
    rewriter = rewriter.on('body', {
      element(el) {
        el.append(
          `\n    <script nonce="${nonce}" defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${token}"}'></script>\n  `,
          { html: true },
        );
      },
    });
  }

  if (env.TURNSTILE_SITE_KEY) {
    const siteKey = escapeForHtml(env.TURNSTILE_SITE_KEY);
    rewriter = rewriter.on('head', {
      element(el) {
        el.append(
          `\n    <script nonce="${nonce}">window.__TURNSTILE_KEY__="${siteKey}";</script>\n  `,
          { html: true },
        );
      },
    });
  }

  return rewriter.transform(response);
}
