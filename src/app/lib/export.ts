/**
 * Export utilities — download, print, and clipboard operations.
 *
 * All exports work from raw text content. No server involvement.
 * - Unified diff: Blob download as `.diff`
 * - HTML: standalone document with two-column diff layout, inline CSS
 * - PDF: `window.print()` — @media print CSS in global.css hides chrome
 * - Copy rich text: Clipboard API with `text/html` + `text/plain` fallback
 */

import { escapeForHtml } from '../../shared/escape';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a unified diff string from two texts.
 *
 * Produces standard unified diff format:
 * ```
 * --- original
 * +++ modified
 * @@ -startA,countA +startB,countB @@
 *  context line
 * -deleted line
 * +added line
 * ```
 */
export function generateUnifiedDiff(
  original: string,
  modified: string,
  title?: string,
): string {
  const linesA = original.split('\n');
  const linesB = modified.split('\n');

  // Simple LCS-based diff (Myers-like, sufficient for export)
  const edits = computeEdits(linesA, linesB);
  const hunks = buildHunks(edits, linesA, linesB, 3);

  const headerA = title ? `--- ${title} (original)` : '--- original';
  const headerB = title ? `+++ ${title} (modified)` : '+++ modified';

  const parts = [headerA, headerB];
  for (const hunk of hunks) {
    parts.push(hunk);
  }

  return parts.join('\n') + '\n';
}

/** Download unified diff as a `.diff` file. */
export function downloadUnifiedDiff(
  original: string,
  modified: string,
  title?: string,
): void {
  const diff = generateUnifiedDiff(original, modified, title);
  const filename = sanitizeFilename(title || 'diff') + '.diff';
  const blob = new Blob([diff], { type: 'text/x-diff;charset=utf-8' });
  downloadBlob(blob, filename);
}

/** Download a standalone HTML diff document. */
export function downloadHtml(
  original: string,
  modified: string,
  title?: string,
): void {
  const doc = buildHtmlDocument(original, modified, title);
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, `${sanitizeFilename(title || 'diff')}.html`);
}

/** Print to PDF via browser print dialog. */
export function printPdf(): void {
  window.print();
}

/**
 * Copy diff as rich text to clipboard.
 * Returns `true` on success, `false` on failure.
 */
export async function copyRichText(
  original: string,
  modified: string,
  title?: string,
): Promise<boolean> {
  const html = buildHtmlBody(original, modified, title);
  const plain = generateUnifiedDiff(original, modified, title);

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    // Fallback: copy plain text unified diff
    try {
      await navigator.clipboard.writeText(plain);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Copy unified diff text to clipboard.
 * Returns `true` on success, `false` on failure.
 */
export async function copyUnifiedDiff(
  original: string,
  modified: string,
  title?: string,
): Promise<boolean> {
  const diff = generateUnifiedDiff(original, modified, title);
  try {
    await navigator.clipboard.writeText(diff);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Diff algorithm — simple edit script (Myers-like)
// ---------------------------------------------------------------------------

type EditOp = { type: 'equal'; lineA: number; lineB: number }
  | { type: 'delete'; lineA: number }
  | { type: 'insert'; lineB: number };

/**
 * Compute an edit script between two line arrays using a simple O(NM)
 * LCS approach. Good enough for export — we don't need the editor's
 * character-level precision here.
 */
function computeEdits(linesA: string[], linesB: string[]): EditOp[] {
  const n = linesA.length;
  const m = linesB.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0) as number[]);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (linesA[i] === linesB[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Trace back to produce edit script
  const edits: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && linesA[i] === linesB[j]) {
      edits.push({ type: 'equal', lineA: i, lineB: j });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      edits.push({ type: 'insert', lineB: j });
      j++;
    } else {
      edits.push({ type: 'delete', lineA: i });
      i++;
    }
  }

  return edits;
}

/**
 * Group edits into unified diff hunks with context lines.
 */
function buildHunks(
  edits: EditOp[],
  linesA: string[],
  linesB: string[],
  contextLines: number,
): string[] {
  // Find change regions (non-equal runs)
  const changes: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].type !== 'equal') {
      const start = i;
      while (i < edits.length && edits[i].type !== 'equal') i++;
      changes.push({ start, end: i });
    }
  }

  if (changes.length === 0) return [];

  // Merge nearby changes into hunks
  const groups: Array<{ start: number; end: number }> = [];
  let current = { start: changes[0].start, end: changes[0].end };
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].start - current.end <= contextLines * 2) {
      current.end = changes[i].end;
    } else {
      groups.push(current);
      current = { start: changes[i].start, end: changes[i].end };
    }
  }
  groups.push(current);

  // Build hunk strings
  const hunks: string[] = [];
  for (const group of groups) {
    const ctxStart = Math.max(0, group.start - contextLines);
    const ctxEnd = Math.min(edits.length, group.end + contextLines);

    let startA = 0;
    let startB = 0;
    // Count starting line numbers
    for (let i = 0; i < ctxStart; i++) {
      const e = edits[i];
      if (e.type === 'equal' || e.type === 'delete') startA++;
      if (e.type === 'equal' || e.type === 'insert') startB++;
    }

    let countA = 0;
    let countB = 0;
    const lines: string[] = [];

    for (let i = ctxStart; i < ctxEnd; i++) {
      const e = edits[i];
      if (e.type === 'equal') {
        lines.push(' ' + linesA[e.lineA]);
        countA++;
        countB++;
      } else if (e.type === 'delete') {
        lines.push('-' + linesA[e.lineA]);
        countA++;
      } else {
        lines.push('+' + linesB[e.lineB]);
        countB++;
      }
    }

    // 1-indexed line numbers in hunk header (use 0 when count is 0, per unified diff spec)
    const hStartA = countA === 0 ? 0 : startA + 1;
    const hStartB = countB === 0 ? 0 : startB + 1;
    const header = `@@ -${hStartA},${countA} +${hStartB},${countB} @@`;
    hunks.push(header + '\n' + lines.join('\n'));
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// HTML export helpers
// ---------------------------------------------------------------------------

/** Build the diff body as an HTML table (two-column). */
function buildHtmlBody(original: string, modified: string, title?: string): string {
  const linesA = original.split('\n');
  const linesB = modified.split('\n');
  const edits = computeEdits(linesA, linesB);

  let titleHtml = '';
  if (title) {
    titleHtml = `<h1>${escapeForHtml(title)}</h1>`;
  }

  // Build rows
  const rows: string[] = [];
  let lineNumA = 0;
  let lineNumB = 0;

  for (const edit of edits) {
    if (edit.type === 'equal') {
      lineNumA++;
      lineNumB++;
      rows.push(
        `<tr>` +
        `<td class="ln">${lineNumA}</td>` +
        `<td class="code">${escapeForHtml(linesA[edit.lineA])}</td>` +
        `<td class="ln">${lineNumB}</td>` +
        `<td class="code">${escapeForHtml(linesB[edit.lineB])}</td>` +
        `</tr>`,
      );
    } else if (edit.type === 'delete') {
      lineNumA++;
      rows.push(
        `<tr>` +
        `<td class="ln del">${lineNumA}</td>` +
        `<td class="code del">${escapeForHtml(linesA[edit.lineA])}</td>` +
        `<td class="ln"></td>` +
        `<td class="code"></td>` +
        `</tr>`,
      );
    } else {
      lineNumB++;
      rows.push(
        `<tr>` +
        `<td class="ln"></td>` +
        `<td class="code"></td>` +
        `<td class="ln add">${lineNumB}</td>` +
        `<td class="code add">${escapeForHtml(linesB[edit.lineB])}</td>` +
        `</tr>`,
      );
    }
  }

  return `${titleHtml}
<table class="diff-table">
<thead><tr><th colspan="2">Original</th><th colspan="2">Modified</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>`;
}

/** Build a complete standalone HTML document. */
function buildHtmlDocument(original: string, modified: string, title?: string): string {
  const body = buildHtmlBody(original, modified, title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeForHtml(title || 'Diff')}</title>
<style>
${INLINE_STYLES}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

function sanitizeFilename(name: string): string {
  const result = name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
  return result || 'diff';
}

// ---------------------------------------------------------------------------
// Inline styles for standalone HTML export
// ---------------------------------------------------------------------------

const INLINE_STYLES = `
*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui,
    'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1d21;
  background: #f4f6f8;
  padding: 1.5rem;
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: #1a1d21;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  table-layout: fixed;
}

.diff-table th {
  background: #eef0f3;
  padding: 0.375rem 0.75rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  border-bottom: 1px solid rgba(26, 29, 33, 0.12);
}

.diff-table td {
  padding: 0 0.5rem;
  vertical-align: top;
  border-bottom: 1px solid rgba(26, 29, 33, 0.04);
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-table .ln {
  width: 3.5rem;
  text-align: right;
  color: #b0b7c3;
  user-select: none;
  padding-right: 0.75rem;
  font-size: 0.75rem;
}

.diff-table .del { background: #fff1f2; }
.diff-table .add { background: #f0fdf4; }
.diff-table .ln.del { background: #fee2e2; color: #dc2626; }
.diff-table .ln.add { background: #dcfce7; color: #16a34a; }

@media (prefers-color-scheme: dark) {
  body { color: #e2e6ed; background: #13151a; }
  h1 { color: #e2e6ed; }
  .diff-table th { background: #1c1f26; color: #8b95a5; border-bottom-color: rgba(226,230,237,0.10); }
  .diff-table td { border-bottom-color: rgba(226,230,237,0.04); }
  .diff-table .ln { color: #3a3f4a; }
  .diff-table .del { background: #1f0d10; }
  .diff-table .add { background: #0d1f17; }
  .diff-table .ln.del { background: #2d0f14; color: #f87171; }
  .diff-table .ln.add { background: #0f2d1a; color: #4ade80; }
}
`.trim();
