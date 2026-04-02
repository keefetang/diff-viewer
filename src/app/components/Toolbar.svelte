<script lang="ts">
  /**
   * Application toolbar — all action groups, responsive layout.
   *
   * Desktop (>=768px): full row with logical groups:
   *   [Diff Viewer | New | Swap] [Collapse | Layout] [Export▾ | Copy | Share▾] [Fork | Delete] [Theme] [Save State | Stats]
   *
   * Mobile (<768px): compact bar:
   *   [Swap | Share] [Save State] [⋯]
   *   Overflow menu: New, Collapse, Export, Copy, Fork, Delete, Theme, Stats
   *
   * Design system: borders-only depth, cool analytical surface, ink text.
   * All values via CSS custom properties — no global.css import.
   */
  import { fly, fade } from 'svelte/transition';
  import { MAX_CONTENT_SIZE } from '../lib/types';
  import type { DiffStats, LayoutMode, SaveState, SizeWarning, ThemeMode } from '../lib/types';
  import { formatStats, formatStatsTooltip } from '../lib/stats';

  const reducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // ─── Constants ──────────────────────────────────────────────────────────────

  const RELATIVE_TIME_INTERVAL_MS = 30_000; // Update "X ago" every 30 seconds

  interface Props {
    stats: DiffStats;
    saveState: SaveState;
    isReadOnly: boolean;
    isNarrow: boolean;
    isCollapsed: boolean;
    lineWrap?: boolean;
    title: string;
    layoutMode?: LayoutMode;
    lastSavedAt?: number | null;
    sizeWarning?: SizeWarning;
    contentSize?: number;
    onTitleChange: (title: string) => void;
    onNew: () => void;
    onSwap: () => void;
    onToggleCollapse: () => void;
    onToggleLineWrap?: () => void;
    onToggleLayout?: () => void;
    onExportDiff: () => void;
    onExportHtml: () => void;
    onExportPdf: () => void;
    onCopyRichText: () => void;
    onShare: (type: 'edit' | 'readonly') => void;
    onFork: () => void;
    onDelete: () => void;
    isPrivate?: boolean;
    onTogglePrivate?: () => void;
    onToggleTheme: () => void;
    themeMode: ThemeMode;
  }

  let {
    stats,
    saveState,
    isReadOnly,
    isNarrow,
    isCollapsed,
    lineWrap = true,
    title,
    layoutMode = 'side-by-side',
    lastSavedAt = null,
    sizeWarning = 'ok',
    contentSize = 0,
    onTitleChange,
    onNew,
    onSwap,
    onToggleCollapse,
    onToggleLineWrap,
    onToggleLayout,
    onExportDiff,
    onExportHtml,
    onExportPdf,
    onCopyRichText,
    onShare,
    onFork,
    onDelete,
    isPrivate = false,
    onTogglePrivate,
    onToggleTheme,
    themeMode,
  }: Props = $props();

  // ─── Dropdown state ──────────────────────────────────────────────────────

  let openDropdown = $state<'export' | 'share' | 'overflow' | null>(null);
  let shareTitleValue = $state('');

  function toggleDropdown(name: 'export' | 'share' | 'overflow'): void {
    if (openDropdown === name) {
      openDropdown = null;
    } else {
      openDropdown = name;
      if (name === 'share') {
        shareTitleValue = title;
      }
    }
  }

  function closeDropdowns(): void {
    openDropdown = null;
  }

  /** Run action + close dropdowns. */
  function dropdownAction(fn: () => void): void {
    fn();
    closeDropdowns();
  }

  // ─── Share popover handlers ─────────────────────────────────────────────

  function handleShareEdit(): void {
    // Save title if changed
    if (shareTitleValue !== title) {
      onTitleChange(shareTitleValue);
    }
    onShare('edit');
    closeDropdowns();
  }

  function handleShareReadOnly(): void {
    if (shareTitleValue !== title) {
      onTitleChange(shareTitleValue);
    }
    onShare('readonly');
    closeDropdowns();
  }

  function handleShareTitleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Default action: copy edit link if not read-only, else read-only link
      if (!isReadOnly) {
        handleShareEdit();
      } else {
        handleShareReadOnly();
      }
    }
  }

  // ─── Click-outside handling ──────────────────────────────────────────────

  function handleWindowClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest('.dropdown') && !target.closest('.overflow-wrap')) {
      closeDropdowns();
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && openDropdown) {
      closeDropdowns();
    }
  }

  // ─── Relative time helper ───────────────────────────────────────────────

  function formatRelativeTime(timestamp: number, now: number): string {
    const delta = Math.max(0, now - timestamp);
    const seconds = Math.floor(delta / 1_000);
    if (seconds < 30) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // Tick counter that increments periodically to trigger relative time re-derivation
  let _timeTick = $state(0);

  $effect(() => {
    // Only start the interval if we have a timestamp to display
    if (lastSavedAt === null) return;
    const id = setInterval(() => { _timeTick++; }, RELATIVE_TIME_INTERVAL_MS);
    return () => clearInterval(id);
  });

  // ─── Size formatting ──────────────────────────────────────────────────────

  /** Format a character count as an approximate size string. */
  function formatSize(chars: number): string {
    if (chars < 1000) return `${chars} chars`;
    return `${Math.round(chars / 1000)}K chars`;
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const saveLabels: Record<SaveState, string> = {
    idle: '',
    saving: 'Saving\u2026',
    saved: 'Saved',
    error: 'Save error',
    readonly: 'Read-only',
  };

  // Compute the save indicator text — augment with relative timestamp
  let saveLabel = $derived.by(() => {
    // Access _timeTick so Svelte tracks the dependency for periodic updates
    void _timeTick;
    const base = saveLabels[saveState];
    if (!base) return '';
    if (saveState === 'saving' || saveState === 'error' || saveState === 'readonly') return base;
    // For 'saved' and 'idle' — show relative time if available
    if (lastSavedAt !== null && (saveState === 'saved' || saveState === 'idle')) {
      const relative = formatRelativeTime(lastSavedAt, Date.now());
      return `Saved ${relative}`;
    }
    return base;
  });

  let saveClass = $derived(
    saveState === 'error' ? 'save-error'
    : saveState === 'saved' ? 'save-success'
    : saveState === 'readonly' ? 'save-readonly'
    : (saveState === 'idle' && lastSavedAt !== null) ? 'save-idle-timestamp'
    : ''
  );

  let sizeDisplay = $derived(
    sizeWarning !== 'ok' ? `${formatSize(contentSize)} / ${formatSize(MAX_CONTENT_SIZE)}` : ''
  );

  let statsDisplay = $derived(formatStats(stats));
  let statsTooltip = $derived(stats.chunks > 0 ? formatStatsTooltip(stats) : '');

  // Theme toggle: icon-only, 3-state cycle (dark → light → system).
  // ☀ (sun) when dark → click to go light; ☾ (moon) when light → click to go system;
  // ◐ (half-circle) when system → click to toggle.
  let themeIcon = $derived(themeMode === 'dark' ? '☀' : themeMode === 'light' ? '☾' : '◐');
  let themeTitle = $derived(
    themeMode === 'dark' ? 'Switch to light mode'
    : themeMode === 'light' ? 'Use system theme'
    : 'Toggle dark mode'
  );
  let themeLabel = $derived(
    themeMode === 'dark' ? 'Light mode'
    : themeMode === 'light' ? 'System theme'
    : 'Toggle theme'
  );
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<header class="toolbar" role="toolbar" data-print="hide">

  {#if !isNarrow}
    <!-- ═══════════════════════════════════════════════════════
         DESKTOP LAYOUT
         Left:  "Diff Viewer" [New] [Swap] | [Export▾] [Copy Diff] [Share▾] | [Fork] [Delete] | Save state
         Right: [Split/Unified] [Wrap] [Collapse] | [☀/☾/◐] | Stats
         ═══════════════════════════════════════════════════════ -->

    <!-- Left: Brand + New + Swap -->
    <div class="btn-group">
      <span class="app-title">Diff Viewer</span>
      {#if !isReadOnly}
        <button class="tool-btn" onclick={onNew} title="New comparison" aria-label="New comparison">New</button>
        <button class="tool-btn" onclick={onSwap} title="Swap original ↔ modified" aria-label="Swap sides">Swap</button>
      {/if}
    </div>

    <!-- Left: Export + Copy + Share -->
    <div class="btn-group">
      <div class="dropdown">
        <button
          class="tool-btn"
          class:active={openDropdown === 'export'}
          onclick={() => toggleDropdown('export')}
          aria-expanded={openDropdown === 'export'}
          aria-haspopup="true"
          aria-label="Export"
        >Export ▾</button>
        {#if openDropdown === 'export'}
          <div class="dropdown-menu" role="menu">
            <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onExportDiff)}>Unified diff (.diff)</button>
            <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onExportHtml)}>HTML (.html)</button>
            <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onExportPdf)}>PDF (print)</button>
          </div>
        {/if}
      </div>

      <button class="tool-btn" onclick={onCopyRichText} title="Copy diff as rich text (Cmd+Shift+D)" aria-label="Copy diff as rich text">Copy Diff</button>

      <div class="dropdown">
        <button
          class="tool-btn"
          class:active={openDropdown === 'share'}
          onclick={() => toggleDropdown('share')}
          aria-expanded={openDropdown === 'share'}
          aria-haspopup="true"
          aria-label="Share"
        >Share ▾</button>
        {#if openDropdown === 'share'}
          <div class="dropdown-menu share-menu" role="menu">
            {#if !isReadOnly && onTogglePrivate}
              <button
                class="dropdown-item"
                class:dropdown-item-active={isPrivate}
                role="menuitem"
                onclick={() => dropdownAction(onTogglePrivate)}
              >Private: {isPrivate ? 'On' : 'Off'}</button>
              <div class="dropdown-divider" role="separator"></div>
            {/if}
            <div class="share-title-field" role="none">
              <label class="share-label" for="share-title-input">Name this comparison (optional)</label>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                id="share-title-input"
                class="share-input"
                type="text"
                placeholder="e.g. API migration v2"
                bind:value={shareTitleValue}
                onkeydown={handleShareTitleKeydown}
                autofocus
              />
            </div>
            <div class="dropdown-divider" role="separator"></div>
            {#if !isReadOnly}
              <button class="dropdown-item" role="menuitem" onclick={handleShareEdit}>Copy edit link</button>
            {/if}
            <button
              class="dropdown-item"
              class:dropdown-item-disabled={isPrivate}
              role="menuitem"
              onclick={() => { if (!isPrivate) handleShareReadOnly(); }}
              title={isPrivate ? 'Private sessions require the edit link' : ''}
              aria-disabled={isPrivate}
            >Copy read-only link</button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Left: Fork + Delete -->
    <div class="btn-group">
      <button class="tool-btn" onclick={onFork} title="Fork as new session" aria-label="Fork session">Fork</button>
      {#if !isReadOnly}
        <button class="tool-btn danger-btn" onclick={onDelete} title="Delete session" aria-label="Delete session">Delete</button>
      {/if}
    </div>

    <!-- Left: Save state -->
    <div class="btn-group">
      {#if sizeDisplay}
        <span
          class="size-indicator"
          class:size-warning={sizeWarning === 'warning'}
          class:size-critical={sizeWarning === 'critical'}
          title={sizeWarning === 'critical' ? 'Content near size limit — save may fail' : 'Content approaching size limit'}
        >{sizeDisplay}</span>
      {/if}
      {#if isReadOnly}
        <span class="readonly-badge">Read-only</span>
      {:else if saveLabel}
        <span class="save-indicator {saveClass}">{saveLabel}</span>
      {/if}
    </div>

    <!-- Spacer pushes right-aligned groups to far right -->
    <div class="toolbar-spacer"></div>

    <!-- Right: View controls -->
    <div class="btn-group">
      {#if onToggleLayout}
        <button
          class="tool-btn layout-toggle"
          onclick={onToggleLayout}
          title={layoutMode === 'side-by-side' ? 'Switch to unified view (Cmd+Shift+L)' : 'Switch to side-by-side view (Cmd+Shift+L)'}
          aria-label={layoutMode === 'side-by-side' ? 'Split view — switch to unified' : 'Unified view — switch to split'}
        >
          <svg class="layout-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            {#if layoutMode === 'side-by-side'}
              <rect x="1" y="2" width="14" height="12" rx="1.5" />
              <line x1="8" y1="2" x2="8" y2="14" />
            {:else}
              <rect x="3" y="2" width="10" height="12" rx="1.5" />
            {/if}
          </svg>
          {layoutMode === 'side-by-side' ? 'Split' : 'Unified'}
        </button>
      {/if}
      {#if onToggleLineWrap}
        <button
          class="tool-btn"
          class:active={lineWrap}
          onclick={onToggleLineWrap}
          title="Toggle word wrap"
          aria-label="Toggle word wrap"
          aria-pressed={lineWrap}
        >Wrap</button>
      {/if}
      <button
        class="tool-btn"
        class:active={isCollapsed}
        onclick={onToggleCollapse}
        title="Collapse unchanged regions"
        aria-label="Toggle collapse unchanged"
        aria-pressed={isCollapsed}
      >Collapse</button>
    </div>

    <!-- Right: Theme icon -->
    <div class="btn-group">
      <button
        class="theme-btn"
        onclick={onToggleTheme}
        title={themeTitle}
        aria-label={themeTitle}
      >{themeIcon}</button>
    </div>

    <!-- Right: Stats -->
    <div class="btn-group">
      {#if statsDisplay}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span class="stats-wrap" tabindex="0" role="group" aria-label="Diff statistics">
          <span class="stats" aria-live="polite">{statsDisplay}</span>
          {#if statsTooltip}
            <span class="stats-tooltip" role="tooltip">{statsTooltip}</span>
          {/if}
        </span>
      {/if}
    </div>

  {:else}
    <!-- ═══════════════════════════════════════════════════════
         MOBILE LAYOUT
         ═══════════════════════════════════════════════════════ -->

    <!-- Left: Swap + Share -->
    <div class="toolbar-group">
      {#if !isReadOnly}
        <button class="tool-btn tool-btn-compact" onclick={onSwap} title="Swap sides" aria-label="Swap sides">⇄</button>
      {/if}
      <div class="dropdown">
        <button
          class="tool-btn tool-btn-compact"
          class:active={openDropdown === 'share'}
          onclick={() => toggleDropdown('share')}
          aria-expanded={openDropdown === 'share'}
          aria-haspopup="true"
          title="Share"
          aria-label="Share"
        >Share</button>
        {#if openDropdown === 'share'}
          <div class="dropdown-menu share-menu" role="menu">
            {#if !isReadOnly && onTogglePrivate}
              <button
                class="dropdown-item"
                class:dropdown-item-active={isPrivate}
                role="menuitem"
                onclick={() => dropdownAction(onTogglePrivate)}
              >Private: {isPrivate ? 'On' : 'Off'}</button>
              <div class="dropdown-divider" role="separator"></div>
            {/if}
            <div class="share-title-field" role="none">
              <label class="share-label" for="share-title-input-mobile">Name this comparison (optional)</label>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                id="share-title-input-mobile"
                class="share-input"
                type="text"
                placeholder="e.g. API migration v2"
                bind:value={shareTitleValue}
                onkeydown={handleShareTitleKeydown}
                autofocus
              />
            </div>
            <div class="dropdown-divider" role="separator"></div>
            {#if !isReadOnly}
              <button class="dropdown-item" role="menuitem" onclick={handleShareEdit}>Copy edit link</button>
            {/if}
            <button
              class="dropdown-item"
              class:dropdown-item-disabled={isPrivate}
              role="menuitem"
              onclick={() => { if (!isPrivate) handleShareReadOnly(); }}
              title={isPrivate ? 'Private sessions require the edit link' : ''}
              aria-disabled={isPrivate}
            >Copy read-only link</button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Center: Save state + Size warning -->
    <div class="toolbar-group toolbar-center-mobile">
      {#if sizeDisplay}
        <span
          class="size-indicator"
          class:size-warning={sizeWarning === 'warning'}
          class:size-critical={sizeWarning === 'critical'}
        >{sizeDisplay}</span>
      {/if}
      {#if isReadOnly}
        <span class="readonly-badge">Read-only</span>
      {:else if saveLabel}
        <span class="save-indicator {saveClass}">{saveLabel}</span>
      {/if}
    </div>

    <!-- Right: Overflow trigger -->
    <div class="toolbar-group overflow-wrap">
      <button
        class="tool-btn overflow-trigger"
        class:active={openDropdown === 'overflow'}
        onclick={() => toggleDropdown('overflow')}
        aria-expanded={openDropdown === 'overflow'}
        aria-haspopup="true"
        aria-label="More actions"
        title="More actions"
      >&#x22EF;</button>
    </div>
  {/if}
</header>

<!-- ═══════════════════════════════════════════════════════
     MOBILE BOTTOM SHEET — rendered outside toolbar to escape overflow-x: auto
     ═══════════════════════════════════════════════════════ -->
{#if isNarrow && openDropdown === 'overflow'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sheet-backdrop"
    onclick={closeDropdowns}
    onkeydown={(e) => { if (e.key === 'Escape') closeDropdowns(); }}
    aria-hidden="true"
    transition:fade={{ duration: reducedMotion ? 0 : 150 }}
  ></div>
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="sheet"
    role="menu"
    aria-label="More actions"
    onkeydown={(e) => { if (e.key === 'Escape') closeDropdowns(); }}
    transition:fly={{ y: 300, duration: reducedMotion ? 0 : 200 }}
  >
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-content">
      {#if !isReadOnly}
        <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onNew)}>New comparison</button>
      {/if}

      <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onToggleCollapse)}>
        {isCollapsed ? 'Expand unchanged' : 'Collapse unchanged'}
      </button>

      {#if onToggleLineWrap}
        <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onToggleLineWrap)}>
          Word wrap: {lineWrap ? 'On' : 'Off'}
        </button>
      {/if}

      <div class="sheet-divider" role="separator"></div>

      <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onExportDiff)}>Export diff (.diff)</button>
      <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onExportHtml)}>Export HTML</button>
      <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onExportPdf)}>Export PDF</button>
      <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onCopyRichText)}>Copy rich text</button>

      <div class="sheet-divider" role="separator"></div>

      <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onFork)}>Fork session</button>

      {#if !isReadOnly}
        <div class="sheet-divider" role="separator"></div>
        <button class="sheet-item sheet-item-danger" role="menuitem" onclick={() => dropdownAction(onDelete)}>Delete session</button>
      {/if}

      <div class="sheet-divider" role="separator"></div>

      <button class="sheet-item" role="menuitem" onclick={() => dropdownAction(onToggleTheme)}>
        {themeIcon} {themeLabel}
      </button>

      {#if statsDisplay}
        <div class="sheet-meta">{statsDisplay}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ── Toolbar shell ── */

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between; /* drives mobile 3-group layout; desktop uses .toolbar-spacer */
    padding: var(--space-1) var(--space-3);
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-width: 0; /* allow flex parent to constrain width below content size */
    z-index: var(--z-toolbar);
    gap: var(--space-2);
    min-height: 44px;
  }

  /* ── Button groups with separator dividers (desktop) ── */

  .btn-group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .btn-group + .btn-group {
    margin-left: var(--space-1);
    padding-left: var(--space-2);
    border-left: 1px solid var(--border-subtle);
  }

  /* Pushes .toolbar-right to far right on desktop.
     Intentionally breaks btn-group + btn-group separator chain —
     the rightmost group is separated by whitespace, not a border. */
  .toolbar-spacer {
    flex: 1;
  }

  .toolbar-right {
    gap: var(--space-3);
  }

  /* ── Mobile toolbar groups (no separators) ── */

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* ── App title ── */

  .app-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    color: var(--text-secondary);
    white-space: nowrap;
    margin-right: var(--space-1);
  }

  /* ── Tool buttons (generic action buttons) ── */

  .tool-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition:
      color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
    line-height: var(--leading-snug);
  }

  .tool-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-inset);
  }

  .tool-btn.active {
    color: var(--text);
    background: var(--surface-inset);
    border-color: var(--border);
  }

  .tool-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tool-btn-compact {
    padding: var(--space-1) var(--space-1);
    font-size: var(--text-xs);
  }

  /* ── Danger button (delete) — red text at rest, red bg on hover ── */

  .danger-btn {
    color: var(--status-error);
  }

  .danger-btn:hover {
    background: color-mix(in srgb, var(--status-error) 12%, transparent);
  }

  .danger-btn:focus-visible {
    outline-color: var(--status-error);
  }

  /* ── Theme button — icon only, same size as tool-btn ── */

  .theme-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 1rem;
    padding: var(--space-1);
    line-height: 1;
    transition: background var(--duration-fast) var(--ease-out),
                color var(--duration-fast) var(--ease-out);
  }

  .theme-btn:hover {
    background: var(--surface);
    color: var(--text);
  }

  /* ── Dropdown ── */

  .dropdown {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    min-width: 160px;
    background: var(--surface-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-1) 0;
    z-index: var(--z-dropdown);
    animation: dropdown-in var(--duration-fast) var(--ease-out);
  }

  .dropdown-menu-right {
    left: auto;
    right: 0;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition:
      color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
    line-height: var(--leading-snug);
  }

  .dropdown-item:hover {
    background: var(--surface-inset);
  }

  .dropdown-item:focus-visible {
    background: var(--surface-inset);
    outline: none;
  }

  .dropdown-item-active {
    color: var(--accent);
    font-weight: var(--weight-medium);
  }

  .dropdown-item-disabled {
    color: var(--text-faint);
    cursor: not-allowed;
  }

  .dropdown-item-disabled:hover {
    background: none;
  }

  .dropdown-item-danger {
    color: var(--status-error);
  }

  .dropdown-item-danger:hover {
    background: color-mix(in srgb, var(--status-error) 8%, transparent);
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: var(--space-1) 0;
  }

  .dropdown-meta {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  @keyframes dropdown-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ── Share popover ── */

  .share-menu {
    min-width: 260px;
  }

  .share-title-field {
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .share-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-muted);
  }

  .share-input {
    width: 100%;
    background: var(--surface-inset);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text);
    line-height: var(--leading-snug);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .share-input::placeholder {
    color: var(--text-faint);
  }

  .share-input:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  /* ── Overflow trigger ── */

  .overflow-wrap {
    position: relative;
  }

  .overflow-trigger {
    font-size: var(--text-md);
    letter-spacing: 0.1em;
    padding: var(--space-1) var(--space-2);
  }

  /* ── Save indicator ── */

  .save-indicator {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .save-success {
    color: var(--status-success);
  }

  .save-error {
    color: var(--status-error);
  }

  .save-readonly {
    color: var(--text-faint);
  }

  .save-idle-timestamp {
    color: var(--text-faint);
  }

  /* ── Size warning indicator ── */

  .size-indicator {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-weight: var(--weight-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
  }

  .size-warning {
    color: var(--status-warning);
    background: color-mix(in srgb, var(--status-warning) 10%, transparent);
  }

  .size-critical {
    color: var(--status-error);
    background: color-mix(in srgb, var(--status-error) 10%, transparent);
  }

  /* ── Mobile center group ── */

  .toolbar-center-mobile {
    flex-direction: column;
    gap: 0;
    align-items: center;
  }

  /* ── Read-only badge ── */

  .readonly-badge {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-faint);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-1);
    white-space: nowrap;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  /* ── Stats (non-interactive, data display) ── */

  .stats-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: default;
    outline: none;
  }

  .stats {
    font-size: 0.75rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }

  .stats-tooltip {
    display: none;
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    min-width: 220px;
    background: var(--surface-overlay);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    white-space: pre-line;
    line-height: var(--leading-normal);
    z-index: var(--z-dropdown);
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }

  .stats-wrap:hover .stats-tooltip,
  .stats-wrap:focus .stats-tooltip {
    display: block;
  }

  /* ── Layout toggle ── */

  .layout-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .layout-icon {
    flex-shrink: 0;
  }

  /* ── Bottom sheet (mobile overflow) ── */

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay);
  }

  .sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 70dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--surface-elevated);
    border-top-left-radius: var(--radius-lg);
    border-top-right-radius: var(--radius-lg);
    z-index: calc(var(--z-overlay) + 1);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .sheet-handle {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-strong);
    margin: var(--space-2) auto;
  }

  .sheet-content {
    padding: 0 0 var(--space-2);
  }

  .sheet-item {
    width: 100%;
    background: none;
    border: none;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    min-height: 44px;
    display: flex;
    align-items: center;
    transition:
      color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
    line-height: var(--leading-snug);
  }

  .sheet-item:hover {
    background: var(--surface-inset);
  }

  .sheet-item:focus-visible {
    background: var(--surface-inset);
    outline: none;
  }

  .sheet-item-danger {
    color: var(--status-error);
  }

  .sheet-item-danger:hover {
    background: color-mix(in srgb, var(--status-error) 8%, transparent);
  }

  .sheet-divider {
    height: 1px;
    background: var(--border);
    margin: var(--space-1) 0;
  }

  .sheet-meta {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
