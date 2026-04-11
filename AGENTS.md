# Diff Viewer — Agent Guide

## What This Project Is

A Cloudflare-native text diff viewer. Paste or type two texts side by side, see a live diff with line and character-level highlights, share via a unique URL. Distinguishes itself through instant diffing, CodeMirror 6 precision, interface craft, and deployment simplicity.

**Stack:** Svelte 5 (runes) + @codemirror/merge + Vite + Cloudflare Workers + Static Assets + KV.

**Audience:** Open-source, deployable to any Cloudflare account via one-click deploy button. Privacy-first: no cookies, no personal data, no tracking.

## Architecture

Single Cloudflare Worker project with three responsibilities:

```
/assets/*  →  CDN (no Worker invocation)
/*         →  Worker
               ├── /         → ASSETS.fetch() + HTMLRewriter (OG tags + SEO content + config)
               ├── /api/*    → REST API (4 endpoints)
               ├── /robots.txt → Static text
               └── /:id      → SSR via HTMLRewriter (OG tags + unified diff + bootstrap data)
```

**Hybrid rendering:** `/:id` routes are server-rendered for crawlers/AI agents (OG meta tags, unified diff text). The SPA boots from injected bootstrap data without a redundant API fetch. The root `/` serves the SPA shell with OG tags, hidden SEO content (feature description in `#content`), and runtime config injected via HTMLRewriter. Private sessions get the bare SPA shell — no SSR, no OG tags, no bootstrap data (the edit token lives in the URL hash which never reaches the server).

**Content negotiation:** Both `/` and `/:id` support two ways to request raw content: the `Accept: text/markdown` header (for programmatic clients) or the `?format=diff` query parameter (for browser address bars, links, and docs). When either is used, `/` returns a markdown description of the tool and `/:id` returns the unified diff as plain text. Private sessions require `X-Edit-Token` for content negotiation too. This enables CLI tools (`curl -H 'Accept: text/markdown'`), AI agents, and direct browser links (`https://diff.pentagram.me/:id?format=diff`) to fetch content without parsing HTML.

**Static assets** (Vite hashed output in `dist/`) are served directly from CDN — the Worker never touches them.

**Diff engine:** `@codemirror/merge` handles all diffing — side-by-side layout, character highlights, synchronized scrolling, alignment spacers, collapse. No separate diff library. Worker SSR uses `Chunk.build()` for stats and unified diff text.

## Project Structure

```
src/
├── shared/
│   └── escape.ts               # Isomorphic HTML escape utilities (browser + Worker)
├── worker/                     # Cloudflare Worker (server)
│   ├── index.ts                # Router: API, SSR, assets, CORS, error handling
│   ├── api.ts                  # REST API: GET, PUT (upsert), DELETE sessions
│   ├── ssr.ts                  # HTMLRewriter SSR for /:id routes (OG tags + diff text)
│   ├── index-content.ts        # Static HTML + markdown content for index page SEO + content negotiation
│   ├── security.ts             # Security headers middleware + CSP nonce injection
│   └── shared.ts               # Shared types (SessionMetadata, DiffSessionValue) + re-exports escape utils
├── app/                        # Svelte 5 SPA (client)
│   ├── main.ts                 # Entry point + theme init
│   ├── App.svelte              # Orchestrator: routing, state, auto-save, actions
│   ├── components/
│   │   ├── DiffEditor.svelte   # Desktop MergeView wrapper (side-by-side)
│   │   ├── MobileDiff.svelte   # Mobile unifiedMergeView wrapper (single column)
│   │   └── Toolbar.svelte      # All actions, desktop + mobile layouts
│   ├── lib/
│   │   ├── api.ts              # Fetch wrapper for session API
│   │   ├── autosave.ts         # Debounced save with state machine
│   │   ├── tokens.ts           # Edit token localStorage management
│   │   ├── turnstile.ts        # Optional Turnstile bot protection
│   │   ├── stats.ts            # Diff stats formatting
│   │   ├── export.ts           # Download diff/html, print pdf, copy rich text
│   │   ├── shortcuts.ts        # Keyboard shortcut bindings
│   │   ├── placeholder.ts      # Default placeholder content for empty editors
│   │   └── types.ts            # Shared TypeScript types (DiffStats, LayoutMode, SaveState, SizeWarning, ThemeMode)
│   └── styles/
│       ├── global.css          # Design system: tokens, reset, light/dark themes
│       ├── editor.css          # CodeMirror theme overrides
│       └── diff.css            # Diff-specific CM6 class overrides (add/remove/spacer)
├── index.html                  # SPA shell (Vite entry, has #content and #app divs)
└── types.d.ts                  # Module declarations (svelte, untyped packages)
```

## Build / Lint / Test Commands

```bash
npm run dev          # Local dev server (wrangler dev, http://localhost:8787)
npm run build        # Vite build → dist/
npm run deploy       # wrangler deploy (KV auto-provisioned on first deploy)
npm run deploy:prod  # Deploy with custom domain (requires .deploy/wrangler.jsonc — see template)
npm run cf-typegen   # Regenerate Worker type bindings

# Type checking (must pass with zero errors AND zero warnings)
npx svelte-check --tsconfig ./tsconfig.json
npx tsc --noEmit     # Worker-only check (faster, skips .svelte files)

# No test framework configured yet. Pure functions in lib/ are testable:
#   stats.ts, tokens.ts, shortcuts.ts, export.ts
```

Build must produce: initial JS < 175kb gzipped. Verify with `npm run build`. No lazy-loaded chunks — @codemirror/merge is in the main bundle.

## Code Style

### TypeScript
- **Strict mode** — `strict: true`, `verbatimModuleSyntax: true`, `isolatedModules: true` in tsconfig.json.
- **Target:** ES2022. Module resolution: `bundler`.
- **Use `import type` for type-only imports** — enforced by `verbatimModuleSyntax`.
- **No `any`** — use `unknown` and narrow, or define proper interfaces.
- **Worker files** declare their own narrowed `Env` interface with only the bindings they need (principle of least privilege). The full `Env` is in `src/worker/index.ts`.

### Svelte 5 Runes Only
- **Use** `$state`, `$derived`, `$effect`, `$props`, `$bindable`.
- **Do NOT use** Svelte 4 syntax: no `$:` reactive statements, no `export let` for props.
- **Props** use the `interface Props {}` pattern with `let { prop = default } = $props<Props>()`.
- **Component methods** exposed via `export function` (not stores or bindings).

### Imports & Module Organization
- Worker files: section with `// ---- Section Name ----` banner comments.
- Svelte files: `<script lang="ts">` with imports grouped: svelte → libraries → local components → local lib → types.
- CSS imports in `.svelte` via `import './styles/foo.css'` (side-effect imports).
- Shared code (`src/shared/`) must never use browser-only APIs (`document`, `window`, `localStorage`).

### Naming Conventions
- **Files:** lowercase-kebab for `.ts`/`.css`, PascalCase for `.svelte` components.
- **Interfaces/Types:** PascalCase (`SessionMetadata`, `DiffStats`, `SaveState`).
- **Constants:** UPPER_SNAKE for module-level (`MAX_CONTENT_LENGTH`, `EXPIRATION_TTL`, `SESSION_ID_RE`).
- **Functions:** camelCase. Prefix handlers with `handle` (`handleApi`, `handleSession`).
- **CSS tokens:** domain-specific names (`--surface`, `--text`, `--border`, `--accent`, `--diff-add-bg`, `--diff-remove-bg`). Never generic (`--gray-700`, `--bg-primary`). See `src/app/styles/global.css`.

### Error Handling
- **Worker API:** Global try/catch in `handleApi`. All errors return `{ error: string }` JSON — never stack traces, binding names, or internal details.
- **Client `localStorage`:** Every access wrapped in try/catch (may be unavailable).
- **Client API calls:** Errors surfaced via `SaveState` (`'error'`) and toast notifications, never `alert()`.
- **Graceful degradation:** Turnstile failure → skip (rate limiting fallback). Clipboard API failure → fallback to `writeText`.

### CSS / Styling
- **All values via design tokens** from `global.css`. No hardcoded hex colors or pixel values outside `:root`.
- **Light + dark** via `@media (prefers-color-scheme: dark)` on `:root` (system preference) AND `[data-theme="dark"]`/`[data-theme="light"]` on `:root` (manual override). 3-state toggle: System / Light / Dark.
- **Borders-only depth** — no box shadows.
- **Scoped styles** in `.svelte` files. Use `:global()` only for CodeMirror class overrides.
- **`color-mix()`** for derived opacity colors instead of hardcoded `rgba`.

## Security Rules (Non-Negotiable)

- Never expose `editToken` in GET responses or SSR bootstrap data.
- Always escape `<` to `\u003c` when embedding JSON in `<script>` tags.
- Always use `crypto.subtle.timingSafeEqual()` for edit token comparison.
- CORS `Access-Control-Allow-Headers` must include `X-Edit-Token`.
- Always add `nonce` attribute to `<script>` tags injected via HTMLRewriter — CSP uses per-request nonces (`crypto.randomUUID()`). Cloudflare Bot Management reads the nonce from the CSP header and adds it to its own injected scripts.
- **No DOMPurify** — diff output is CM6 decorations (DOM elements created by CodeMirror), not `{@html}` injection. HTML export uses `escapeForHtml()`.

## Data Model

### Sessions
```
KV key:       nanoid(12) — URL-safe, cryptographically random
KV value:     JSON.stringify({ original: string, modified: string, title?: string })
KV metadata:  { createdAt: number, updatedAt: number, editToken: string, private?: boolean, ttl?: number }
KV TTL:       7,776,000 seconds (90 days) for browser sessions, 2,592,000 (30 days) for agent sessions — reset on every save
```

`private` is backward-compatible: absent or `false` = public session. `ttl` is set at creation and preserved on update.

### API Surface
| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/api/sessions/:id` | Conditional | Read session. Private sessions require `X-Edit-Token` (returns 404 without — hides existence). Returns `{ id, original, modified, title, metadata: { createdAt, updatedAt }, private, expiresAt }`. Conditional: `If-None-Match` → 304, `If-Modified-Since` → 304. All responses include `ETag`, `Last-Modified`, `Vary: Accept`, `X-Expires-At` headers. Never returns editToken. |
| PUT | `/api/sessions/:id` | Conditional | Accepts `application/json`. Body accepts `private: boolean`. Also accepts `X-Private: true` header (agents may prefer headers). No token + new → CREATE (201 + `{ id, editToken, private, url, editUrl, expiresAt }`). Valid token + exists → UPDATE (200 + `{ id, metadata, private, expiresAt }`). Invalid/missing token + exists → 403. All success responses include `ETag`, `Last-Modified`, `Vary: Accept`, `X-Expires-At` headers. Turnstile is a fast-pass, not a gate — absent tokens skip verification (rate limiting fallback). |
| DELETE | `/api/sessions/:id` | `X-Edit-Token` | Deletes session. 403 without valid token. |
| OPTIONS | `/api/*` | None | CORS preflight. `Access-Control-Allow-Headers` includes `X-Edit-Token, X-Private, If-Match, If-None-Match, If-Modified-Since`. `Access-Control-Expose-Headers` includes `ETag, Last-Modified, X-Expires-At`. |

ID validation on all endpoints: `/^[A-Za-z0-9_-]{12}$/`. Reject 400 if invalid.

### localStorage Keys
| Key | Purpose |
|-----|---------|
| `diff-viewer-theme` | Theme preference (light/dark/system) |
| `diff-viewer-layout` | Layout mode preference |
| `diff-viewer-line-wrap` | Word wrap toggle. Stored as `"true"`/`"false"`, defaults to `true`. |
| `diff-token:{id}` | Per-session edit tokens (one per session ID) |

## Performance Constraints

- **Initial bundle target: < 175kb gzipped** (verify with `npm run build` — single JS + CSS bundle)
- No lazy-loaded chunks — the entire app loads in one request
- No DOMPurify, no highlight.js, no language modes — leaner than markdown-viewer

## Environment Variables (all optional)

| Variable | Purpose | Where Set |
|----------|---------|-----------|
| `CF_ANALYTICS_TOKEN` | Cloudflare Web Analytics (cookie-free) | wrangler secret / dashboard |
| `TURNSTILE_SITE_KEY` | Bot protection — public site key | wrangler var / dashboard |
| `TURNSTILE_SECRET_KEY` | Bot protection — secret key | wrangler secret / dashboard |
| `CORS_ORIGIN` | Restrict API to specific origin (defaults to `*`) | wrangler var / dashboard |

Without any configuration, the app works fully — protected by rate limiting only.

## Domain Skills

When working on this project, load these skills as relevant:
- `cloudflare` — platform knowledge, product selection
- `wrangler` — CLI commands, config format
- `workers-best-practices` — Worker patterns, anti-patterns
- `typescript` — type conventions
- `interface-design` — UI craft, design system, component patterns
- `web-perf` — Lighthouse, Core Web Vitals measurement


## Git Conventions

- **Always confirm with the user before pushing to remote.** No autonomous pushes.
- **Squash related commits before pushing** when possible — keep the history clean and meaningful.
- **Force push is allowed** for the repo admin but should be used deliberately (e.g., squashing before push, not after).
- **Branch protection:** PRs must pass CI (`check` job) before merging. Direct pushes to main are allowed.
- **Dependabot:** Patch/minor PRs can be merged if CI passes. Major version bumps should be tested locally first.
