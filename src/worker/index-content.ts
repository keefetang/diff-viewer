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
<li>Deploy your own instance to Cloudflare in one click — zero configuration required</li>
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
- Deploy your own instance to Cloudflare in one click — zero configuration required

No cookies. No tracking. No user accounts. Sessions contain only your two texts and timestamps, and auto-expire after 90 days of inactivity.

[View on GitHub](https://github.com/keefetang/diff-viewer)
`;
}
