<script lang="ts">
  /**
   * Application toolbar — all action groups, responsive layout.
   *
   * Desktop (>=768px): full row with logical groups:
   *   [Diff Viewer | New | Swap] [←Chunk Chunk→ | Collapse] [Export▾ | Copy | Share▾] [Fork | Delete] [Theme] [Save State | Stats]
   *
   * Mobile (<768px): compact bar:
   *   [Swap | Share] [Save State] [⋯]
   *   Overflow menu: New, Chunk nav, Collapse, Export, Copy, Fork, Delete, Theme, Stats
   *
   * Design system: borders-only depth, cool analytical surface, ink text.
   * All values via CSS custom properties — no global.css import.
   */
  import { MAX_CONTENT_SIZE } from '../lib/types';
  import type { DiffStats, LayoutMode, SaveState, SizeWarning, ThemeMode } from '../lib/types';
  import { formatStats, formatStatsTooltip } from '../lib/stats';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const RELATIVE_TIME_INTERVAL_MS = 30_000; // Update "X ago" every 30 seconds

  interface Props {
    stats: DiffStats;
    saveState: SaveState;
    isReadOnly: boolean;
    isNarrow: boolean;
    isCollapsed: boolean;
    title: string;
    layoutMode?: LayoutMode;
    lastSavedAt?: number | null;
    sizeWarning?: SizeWarning;
    contentSize?: number;
    onTitleChange: (title: string) => void;
    onNew: () => void;
    onSwap: () => void;
    onPrevChunk: () => void;
    onNextChunk: () => void;
    onToggleCollapse: () => void;
    onToggleLayout?: () => void;
    onExportDiff: () => void;
    onExportHtml: () => void;
    onExportPdf: () => void;
    onCopyRichText: () => void;
    onShare: (type: 'edit' | 'readonly') => void;
    onFork: () => void;
    onDelete: () => void;
    onToggleTheme: () => void;
    themeMode: ThemeMode;
  }

  let {
    stats,
    saveState,
    isReadOnly,
    isNarrow,
    isCollapsed,
    title,
    layoutMode = 'side-by-side',
    lastSavedAt = null,
    sizeWarning = 'ok',
    contentSize = 0,
    onTitleChange,
    onNew,
    onSwap,
    onPrevChunk,
    onNextChunk,
    onToggleCollapse,
    onToggleLayout,
    onExportDiff,
    onExportHtml,
    onExportPdf,
    onCopyRichText,
    onShare,
    onFork,
    onDelete,
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
    if (chars < 1024) return `${chars} B`;
    return `${Math.round(chars / 1024)} KB`;
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

  // Theme toggle: visible text IS the accessible name (no separate aria-label).
  // Lighthouse requires visible text to match the accessible name (WCAG 2.5.3).
  let themeLabel = $derived(themeMode === 'dark' ? '☾ Dark' : themeMode === 'light' ? '☀ Light' : 'Auto');
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<header class="toolbar" role="toolbar" data-print="hide">

  {#if !isNarrow}
    <!-- ═══════════════════════════════════════════════════════
         DESKTOP LAYOUT
         ═══════════════════════════════════════════════════════ -->

    <!-- Group 1: Brand + New + Swap -->
    <div class="btn-group">
      <span class="app-title">Diff Viewer</span>
      {#if !isReadOnly}
        <button class="tool-btn" onclick={onNew} title="New comparison" aria-label="New comparison">New</button>
        <button class="tool-btn" onclick={onSwap} title="Swap original ↔ modified" aria-label="Swap sides">Swap</button>
      {/if}
    </div>

    <!-- Group 2: Chunk navigation + Collapse -->
    <div class="btn-group">
      <button
        class="tool-btn"
        onclick={onPrevChunk}
        title="Previous change (Alt+↑)"
        aria-label="Previous change"
        disabled={stats.chunks === 0}
      >← Prev</button>
      <button
        class="tool-btn"
        onclick={onNextChunk}
        title="Next change (Alt+↓)"
        aria-label="Next change"
        disabled={stats.chunks === 0}
      >Next →</button>
      <button
        class="tool-btn"
        class:active={isCollapsed}
        onclick={onToggleCollapse}
        title="Collapse unchanged regions"
        aria-label="Toggle collapse unchanged"
        aria-pressed={isCollapsed}
      >Collapse</button>
      {#if onToggleLayout}
        <button
          class="tool-btn"
          onclick={onToggleLayout}
          title={layoutMode === 'side-by-side' ? 'Switch to unified view (Cmd+Shift+L)' : 'Switch to side-by-side view (Cmd+Shift+L)'}
          aria-label={layoutMode === 'side-by-side' ? 'Switch to unified view' : 'Switch to side-by-side view'}
        ><!-- layout icon: two columns for split, single column for unified -->
          <svg class="layout-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            {#if layoutMode === 'side-by-side'}
              <rect x="1" y="2" width="14" height="12" rx="1.5" />
              <line x1="8" y1="2" x2="8" y2="14" />
            {:else}
              <rect x="3" y="2" width="10" height="12" rx="1.5" />
            {/if}
          </svg>
          <span class="layout-label">{layoutMode === 'side-by-side' ? 'Split' : 'Unified'}</span>
        </button>
      {/if}
    </div>

    <!-- Group 3: Export + Copy + Share -->
    <div class="btn-group">
      <!-- Export dropdown -->
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

      <!-- Share dropdown / popover -->
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
            <button class="dropdown-item" role="menuitem" onclick={handleShareReadOnly}>Copy read-only link</button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Group 4: Fork + Delete -->
    <div class="btn-group">
      <button class="tool-btn" onclick={onFork} title="Fork as new session" aria-label="Fork session">Fork</button>
      {#if !isReadOnly}
        <button class="tool-btn delete-btn" onclick={onDelete} title="Delete session" aria-label="Delete session">Delete</button>
      {/if}
    </div>

    <!-- Group 5: Theme toggle -->
    <div class="btn-group">
      <button
        class="tool-btn"
        onclick={onToggleTheme}
        title={themeLabel}
      >{themeLabel}</button>
    </div>

    <!-- Spacer pushes save + stats to the right -->
    <div class="toolbar-spacer"></div>

    <!-- Group 6: Size warning + Save state + Stats -->
    <div class="btn-group toolbar-right">
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
            <button class="dropdown-item" role="menuitem" onclick={handleShareReadOnly}>Copy read-only link</button>
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

    <!-- Right: Overflow menu -->
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

      {#if openDropdown === 'overflow'}
        <div class="dropdown-menu dropdown-menu-right overflow-menu" role="menu">
          {#if !isReadOnly}
            <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onNew)}>New comparison</button>
          {/if}

          <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onExportDiff)}>Export diff (.diff)</button>
          <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onExportHtml)}>Export HTML</button>
          <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onExportPdf)}>Export PDF</button>
          <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onCopyRichText)}>Copy rich text</button>

          <div class="dropdown-divider" role="separator"></div>

          <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onFork)}>Fork session</button>

          {#if !isReadOnly}
            <div class="dropdown-divider" role="separator"></div>
            <button class="dropdown-item dropdown-item-danger" role="menuitem" onclick={() => dropdownAction(onDelete)}>Delete session</button>
          {/if}

          <div class="dropdown-divider" role="separator"></div>

          <button class="dropdown-item" role="menuitem" onclick={() => dropdownAction(onToggleTheme)}>
            {themeLabel}
          </button>

          {#if statsDisplay}
            <div class="dropdown-meta">{statsDisplay}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</header>

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
    font-weight: var(--weight-normal);
    letter-spacing: var(--tracking-normal);
    color: var(--text-muted);
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

  /* ── Delete button — inherits .tool-btn at rest, red on hover/focus ── */

  .delete-btn:hover {
    color: var(--status-error);
    background: color-mix(in srgb, var(--status-error) 10%, transparent);
  }

  .delete-btn:focus-visible {
    color: var(--status-error);
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

  .overflow-menu {
    min-width: 200px;
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

  .layout-icon {
    vertical-align: middle;
    flex-shrink: 0;
  }

  .layout-label {
    margin-left: var(--space-1);
    vertical-align: middle;
  }
</style>
