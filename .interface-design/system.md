# Diff Viewer — Interface Design System

## Direction and Feel

**Domain:** Comparison, change tracking, code review, precision analysis. The inspection bench. Pull request review, document red-lining, unified/split diff, forensic investigation of text change.

**Feel:** Clean, precise, analytical. Not warm, not playful. Think GitHub PR review, not a writing app. The interface should feel like a professional instrument — everything exists to surface change with clarity and zero noise.

**Depth strategy:** Borders-only. No shadows. Technical, flat, trustworthy. Shadows would add warmth and approachability — this tool doesn't want that.

**Spacing base:** 4px (`--space-1` = 4px, `--space-2` = 8px, …). Named numerically for clarity.

---

## Domain Exploration

**Concepts from the product's world:**
- Red lines / strikethrough on legal documents
- Git diff hunks — @@ markers, +/- lines
- Code review annotations — inline comments on changed lines
- Spectroscopy — precise measurement of differences
- A/B comparison — two states held side by side
- Change logs — sequential record of what changed and when

**Color world:** The physical world of comparison and markup:
- The red pen on a manuscript — `#dc2626`
- Green highlighter marking correct changes — `#16a34a`
- The pale yellow of a comparison print-out — close to white, not warm
- Blueprint blue — the color of precise technical drawing — `#2563eb`
- Cool grey of a surgical table — `#f4f6f8`
- The near-black of technical annotation — `#1a1d21`

**Signature:** The `--diff-*` token group. These four tokens ARE the product. The green/rose line washes and character highlights are what the user comes here for. Every other token exists to frame them without competing.

**Defaults rejected:**
1. Warm backgrounds → replaced with cool blue-grey tinted surfaces (`#f4f6f8` not `#faf8f5`)
2. Amber/orange accent → replaced with precise blueprint blue (`#2563eb`)
3. Generic gray text → replaced with a cool-tinted text hierarchy (`#1a1d21`, `#4a5060`, `#6b7280`)

---

## Token Reference

### Surface Tokens

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--surface` | `#f4f6f8` | `#13151a` | Base canvas |
| `--surface-elevated` | `#ffffff` | `#1c1f26` | Toolbar, panels |
| `--surface-inset` | `#e8ecf1` | `#0e1014` | Editor area, inputs |
| `--surface-overlay` | `#ffffff` | `#22252d` | Modal, dialog |

**Rationale:** Cool blue-grey base (not warm). Slight blue tint on every level. Elevation in light = whiter; elevation in dark = slightly lighter charcoal. Same hue throughout — only lightness shifts.

### Text Tokens

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--text` | `#1a1d21` | `#e2e6ed` | Primary |
| `--text-secondary` | `#4a5060` | `#9aa3b2` | Supporting |
| `--text-muted` | `#6b7280` | `#8b95a5` | Labels, metadata |
| `--text-faint` | `#b0b7c3` | `#3a3f4a` | Disabled, ghost (WCAG 1.4.3 exemption: inactive/disabled only) |
| `--text-inverse` | `#f4f6f8` | `#13151a` | On accent backgrounds |

**Rationale:** Cool-tinted text, not warm. `--text-muted` differs between modes: `#6b7280` meets 4.5:1 on light surfaces; dark surfaces are significantly darker so the value is lightened to `#8b95a5` (4.72:1 on `surface-elevated`, 5.54:1 on `surface-inset`). Pane labels and gutter numbers render at small sizes (0.75rem–0.8125rem) and require the full 4.5:1 ratio.

### Border Tokens

| Token | Value | Role |
|-------|-------|------|
| `--border` | `rgba(26,29,33,0.12)` / `rgba(226,230,237,0.10)` | Standard separation |
| `--border-subtle` | `rgba(26,29,33,0.06)` / `rgba(226,230,237,0.05)` | Soft separation |
| `--border-strong` | `rgba(26,29,33,0.20)` / `rgba(226,230,237,0.18)` | Emphasis |
| `--border-focus` | `rgba(37,99,235,0.50)` / `rgba(96,165,250,0.50)` | Focus rings |

**Rationale:** rgba borders blend with their background — they define edges without demanding attention. Same approach as the markdown-viewer but with cool-tinted base color.

### Accent Tokens

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--accent` | `#2563eb` | `#60a5fa` | Primary interactive |
| `--accent-hover` | `#1d4ed8` | `#93c5fd` | Hover state |
| `--accent-active` | `#1e40af` | `#3b82f6` | Active/pressed |

**Rationale:** Blueprint blue — precise, technical, unambiguous. Lightened for dark backgrounds. Not warm purple, not teal — a clear, decisive blue that belongs on a technical instrument.

### Semantic Tokens

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--status-error` | `#dc2626` | `#f87171` | Destructive, invalid |
| `--status-warning` | `#d97706` | `#fbbf24` | Caution, unsaved |
| `--status-success` | `#16a34a` | `#4ade80` | Confirmed, saved |

---

## Diff Color Tokens — The Signature

These are the most carefully considered tokens in the system.

### Visual Hierarchy (4 layers)

The diff CSS creates a clear visual hierarchy — most subtle to most visible:

1. **Unchanged lines** — no styling. The baseline. Most content should look "normal."
2. **`.cm-changedLine`** — barely perceptible hint via `--diff-change-hint`. Lines in a diff chunk but not necessarily changed. A whisper: "something changed nearby."
3. **`.cm-deletedLine` / `.cm-insertedLine`** — clear line-level add/remove backgrounds via `--diff-add-bg` / `--diff-remove-bg`. Pure additions/removals are immediately visible.
4. **`.cm-changedText`** — STRONG character-level highlight via `--diff-add-highlight` / `--diff-remove-highlight`. The specific characters that differ — the money signal.

Character highlights are scoped to the correct pane: `.cm-mergeViewEditor:first-child` (original) uses remove highlights; `.cm-mergeViewEditor:last-child` (modified) uses add highlights.

### Strategy

**Changed-line hint** (`--diff-change-hint`): Nearly invisible tint. Lines that sit inside a diff chunk get this background even if their text is identical. So subtle you almost can't see it — just enough context to identify the neighborhood of a change.

**Line backgrounds** (`-bg` tokens): Low saturation wash. Whole-line backgrounds appear on purely added/deleted lines. Clear green/rose signal without eye fatigue.

**Character highlights** (`-highlight` tokens): More saturated than the line wash. These pinpoint the exact characters that changed within a line. They pop out of the line background clearly — this is what the user came to see.

### Light Mode Values

| Token | Value | What It Is |
|-------|-------|------------|
| `--diff-change-hint` | `rgba(0,0,0,0.025)` | Barely visible — lines near a change |
| `--diff-add-bg` | `#dcfce7` | Visible green wash — whole added lines |
| `--diff-add-highlight` | `#86efac` | Strong green — character-level adds |
| `--diff-remove-bg` | `#ffe4e6` | Visible rose wash — whole deleted lines |
| `--diff-remove-highlight` | `#fda4af` | Strong rose — character-level deletions |

**Highlight naming note:** `--diff-add-highlight` and `--diff-remove-highlight` are **background** colors for character-level highlights (`.cm-changedText`), not text colors. Current base text contrast: `--text` on light highlights ≈ 8.7:1 / 7.8:1 ✓; `--text` on dark highlights ≈ 5.7–6.4:1 ✓.

### Dark Mode Values

| Token | Value | Approach |
|-------|-------|----------|
| `--diff-change-hint` | `rgba(255,255,255,0.03)` | Barely visible — lines near a change |
| `--diff-add-bg` | `#12291b` | Green tint, clearly distinct from `#13151a` editor bg |
| `--diff-add-highlight` | `#1a5c35` | Saturated green — pops against dark bg |
| `--diff-remove-bg` | `#291215` | Rose tint, clearly distinct from `#13151a` editor bg |
| `--diff-remove-highlight` | `#8b1a3a` | Saturated rose — pops against dark bg |

**Dark mode rationale:** Line backgrounds must be clearly distinguishable from the editor surface (`#13151a`) AND from each other. Previous values (`#0d1f17` / `#1f0d10`) were nearly indistinguishable on a `#13151a` background. Character highlights must be significantly stronger than line backgrounds — they carry the primary change signal. The green/rose relationship is preserved through hue and moderate saturation.

### CM6 Override: `background` vs `background-color`

CM6's `@codemirror/merge` generates scoped styles with dynamic class names (`.ͼN`) that use the `background` shorthand to draw a 2px gradient underline on `.cm-changedText`:

```css
.ͼ2.cm-merge-a .cm-changedText {
  background: linear-gradient(...) center bottom / 100% 2px no-repeat;
}
```

Because `background` is the shorthand, it resets all background sub-properties — including `background-color`. Our overrides in `diff.css` must use `background` (not `background-color`) + `!important` to fully replace CM6's gradient with a solid fill. This is the difference between character highlights showing as underlines vs background fills.

---

## Typography

- `--font-sans`: System sans-serif stack — UI chrome, labels, toolbar
- `--font-mono`: System monospace stack — editor content, diff output, gutter numbers, code references

No external font loading. The product is a utility — fast load, no web font flash.

---

## Component Patterns

### Toolbar
- Height: 48px (fixed)
- Background: `--surface-elevated`
- Bottom border: `1px solid var(--border)`
- Title: `0.875rem`, `font-weight: 600`, `--text-secondary`, `letter-spacing: var(--tracking-wide)`, `text-transform: uppercase`
- `z-index: var(--z-toolbar)`

### Pane Labels
- Background: `--surface-elevated`
- Bottom border: `1px solid var(--border-subtle)` (lighter than toolbar border — labels are secondary chrome)
- Text: `0.75rem`, `font-weight: 600`, `text-transform: uppercase`, `letter-spacing: var(--tracking-wide)`, `--text-muted`

### Pane Divider
- Width: `2px` (strengthened for visibility — especially in dark mode)
- Color: `var(--border)`
- Mobile: becomes a horizontal `1px` rule when stacked

### Editor Surface
- Background: `--surface-inset` (recessed from canvas — signals "type here")
- Font: `--font-mono`, `0.875rem`
- Fills remaining height after toolbar + pane labels

---

## Theme System

Implemented via `data-theme` attribute on `:root` (set by `main.ts` before mount):

```
No data-theme → follows @media (prefers-color-scheme: dark)
data-theme="dark"  → always dark
data-theme="light" → always light
```

Theme preference key in localStorage: `diff-viewer-theme`


