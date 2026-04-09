/**
 * Static content for the index page — HTML for SEO injection and markdown
 * for content negotiation (`Accept: text/markdown`).
 *
 * Kept concise — this is for crawlers and CLI tools, not a landing page.
 */

// ---- HTML Content ----

export function getIndexHtml(): string {
  return `<h1>Diff Viewer</h1>
<p>A fast, privacy-first text diff tool. Paste two texts, see a live diff with line and character-level highlights, and share via a unique URL. No accounts required.</p>
<h2>Features</h2>
<ul>
<li>Side-by-side diff with line and character-level highlights, synchronized scrolling, and collapse</li>
<li>Live updates on every keystroke via CodeMirror 6 merge view</li>
<li>Auto-save with shareable URLs — edit links with write access and read-only links for sharing</li>
<li>Export as unified diff, standalone HTML, PDF, or copy as rich text</li>
<li>View raw unified diff via <code>?format=diff</code> query parameter</li>
<li>Deploy your own instance to Cloudflare in one click — zero configuration required</li>
</ul>
<h2>Programmatic Access</h2>
<ul>
<li>REST API — create, read, update, delete diff sessions with JSON</li>
<li>Content negotiation — <code>Accept: text/markdown</code> or <code>?format=diff</code> returns unified diff text</li>
<li>Conditional requests — ETag and If-None-Match support for efficient polling (304 Not Modified)</li>
<li>Private sessions with edit token authentication</li>
</ul>
<p>No cookies. No tracking. No user accounts. Sessions contain only your two texts and timestamps, and auto-expire after 90 days of inactivity.</p>
<p><a href="https://github.com/keefetang/diff-viewer">View on GitHub</a></p>`;
}

// ---- Markdown Content ----

export function getIndexMarkdown(): string {
  return `# Diff Viewer

A fast, privacy-first text diff tool. Paste two texts, see a live diff with line and character-level highlights, and share via a unique URL. No accounts required.

## Features

- Side-by-side diff with line and character-level highlights, synchronized scrolling, and collapse
- Live updates on every keystroke via CodeMirror 6 merge view
- Auto-save with shareable URLs — edit links with write access and read-only links for sharing
- Export as unified diff, standalone HTML, PDF, or copy as rich text
- View raw unified diff via \`?format=diff\` query parameter
- Deploy your own instance to Cloudflare in one click — zero configuration required

## Programmatic Access

- REST API — create, read, update, delete diff sessions with JSON
- Content negotiation — \`Accept: text/markdown\` or \`?format=diff\` returns unified diff text
- Conditional requests — ETag and If-None-Match support for efficient polling (304 Not Modified)
- Private sessions with edit token authentication

No cookies. No tracking. No user accounts. Sessions contain only your two texts and timestamps, and auto-expire after 90 days of inactivity.

[View on GitHub](https://github.com/keefetang/diff-viewer)
`;
}
