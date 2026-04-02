<script lang="ts">
  /**
   * App shell — the orchestrator.
   *
   * Owns the single source of truth (original, modified, title), manages
   * routing, edit tokens, auto-save, and composes the toolbar + editor layout.
   *
   * Routing:
   *   `/`            → new session (placeholder content, editable)
   *   `/:id`         → existing session (read-only unless token found)
   *   `/:id#token=…` → existing session (extract token, store, clean URL, editable)
   */
  import { onMount } from 'svelte';
  import { nanoid } from 'nanoid';
  // global.css is imported in main.ts — do not import again here.
  import { PLACEHOLDER } from './lib/placeholder';
  import { MAX_CONTENT_SIZE } from './lib/types';
  import type { DiffStats, LayoutMode, SaveState, SizeWarning, ThemeMode } from './lib/types';
  import DiffEditor from './components/DiffEditor.svelte';
  import MobileDiff from './components/MobileDiff.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import { getSession, saveSession, deleteSession } from './lib/api';
  import type { CreateResponse } from './lib/api';
  import { storeToken, getStoredToken, extractAndCleanToken, removeToken } from './lib/tokens';
  import { createAutosave } from './lib/autosave';
  import type { AutosaveHandle } from './lib/autosave';
  import { initTurnstile, getTurnstileToken, isTurnstileConfigured } from './lib/turnstile';
  import { setupShortcuts } from './lib/shortcuts';
  import {
    downloadUnifiedDiff,
    downloadHtml,
    printPdf,
    copyRichText,
  } from './lib/export';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const THEME_KEY = 'diff-viewer-theme';
  const LAYOUT_KEY = 'diff-viewer-layout';
  const SESSION_ID_RE = /^[A-Za-z0-9_-]{12}$/;
  const DELETE_UNDO_MS = 10_000;

  // Content size warning thresholds (character count — approximate, not byte-exact).
  // Server enforces MAX_CONTENT_SIZE on the serialized JSON byte length; character
  // count is a reasonable proxy for a UI-only warning. The server is the true enforcer.
  const WARN_THRESHOLD = 921_600;       // ~90% of MAX_CONTENT_SIZE
  const CRITICAL_THRESHOLD = 998_400;   // ~95% of MAX_CONTENT_SIZE

  // ─── State ──────────────────────────────────────────────────────────────────

  let original = $state(PLACEHOLDER.original);
  let modified = $state(PLACEHOLDER.modified);
  let title = $state('');
  let saveState = $state<SaveState>('idle');
  let stats = $state<DiffStats>({ additions: 0, deletions: 0, chunks: 0, originalLines: 0, modifiedLines: 0 });
  let isNarrow = $state(false);
  let isReadOnly = $state(false);
  let isCollapsed = $state(false);
  let themeMode = $state<ThemeMode>('system');
  let layoutMode = $state<LayoutMode>('side-by-side');
  let lastSavedAt = $state<number | null>(null);

  // Toast state
  let toastMessage = $state('');
  let toastType = $state<'info' | 'success' | 'error'>('info');
  let toastAction = $state<{ label: string; handler: () => void } | null>(null);

  // Session state — not reactive via $state because they don't drive UI rendering
  let sessionId = '';
  let editToken: string | null = null;
  let autosave: AutosaveHandle | undefined;

  // Delete undo state
  let deleteUndoOriginal: string | null = null;
  let deleteUndoModified: string | null = null;
  let deleteUndoTitle: string | null = null;
  let deleteUndoTimer: ReturnType<typeof setTimeout> | undefined;
  let undoInProgress = false;

  let diffEditor: DiffEditor | undefined = $state();
  let mobileDiff: MobileDiff | undefined = $state();

  /** Return whichever editor component is currently active. */
  function activeEditor(): DiffEditor | MobileDiff | undefined {
    return (isNarrow || layoutMode === 'unified') ? mobileDiff : diffEditor;
  }

  // ─── Toast helper ───────────────────────────────────────────────────────────

  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showToast(
    message: string,
    options: {
      type?: 'info' | 'success' | 'error';
      durationMs?: number;
      action?: { label: string; handler: () => void };
    } = {},
  ): void {
    const { type = 'info', durationMs = 4000, action = null } = options;
    toastMessage = message;
    toastType = type;
    toastAction = action;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dismissToast();
    }, durationMs);
  }

  function dismissToast(): void {
    toastMessage = '';
    toastAction = null;
    clearTimeout(toastTimer);
  }

  // ─── Derived values ──────────────────────────────────────────────────────────

  let contentSize = $derived(original.length + modified.length + (title?.length ?? 0));
  let sizeWarning = $derived<SizeWarning>(
    contentSize >= CRITICAL_THRESHOLD ? 'critical'
    : contentSize >= WARN_THRESHOLD ? 'warning'
    : 'ok'
  );

  // ─── Viewport tracking ─────────────────────────────────────────────────────

  $effect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    isNarrow = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      isNarrow = e.matches;
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  // ─── Routing helpers ────────────────────────────────────────────────────────

  function parseRoute(): string | null {
    const pathname = window.location.pathname;
    if (pathname === '/' || pathname === '') return null;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 1 && SESSION_ID_RE.test(segments[0])) {
      return segments[0];
    }
    return null;
  }

  function getBootstrapData(): { original: string; modified: string; title?: string; metadata?: { createdAt: number; updatedAt: number } } | null {
    const el = document.getElementById('__DATA__');
    if (!el?.textContent) return null;
    try {
      const data = JSON.parse(el.textContent) as {
        original?: string;
        modified?: string;
        title?: string;
        metadata?: { createdAt?: number; updatedAt?: number };
      };
      if (typeof data.original === 'string' && typeof data.modified === 'string') {
        const result: { original: string; modified: string; title?: string; metadata?: { createdAt: number; updatedAt: number } } = {
          original: data.original,
          modified: data.modified,
          title: data.title,
        };
        if (data.metadata && typeof data.metadata.updatedAt === 'number' && typeof data.metadata.createdAt === 'number') {
          result.metadata = { createdAt: data.metadata.createdAt, updatedAt: data.metadata.updatedAt };
        }
        return result;
      }
    } catch {
      // Malformed bootstrap data — fall through to API fetch
    }
    return null;
  }

  // ─── Lifecycle / Routing ────────────────────────────────────────────────────

  onMount(() => {
    // --- Routing: determine session mode ---
    const routeId = parseRoute();

    initTurnstile();

    if (routeId === null) {
      sessionId = nanoid(12);
      editToken = null;
      isReadOnly = false;
    } else {
      sessionId = routeId;
      const hashToken = extractAndCleanToken();
      if (hashToken) {
        editToken = hashToken;
        storeToken(sessionId, hashToken);
      } else {
        editToken = getStoredToken(sessionId);
      }
      isReadOnly = !editToken;

      const bootstrap = getBootstrapData();
      if (bootstrap) {
        original = bootstrap.original;
        modified = bootstrap.modified;
        title = bootstrap.title ?? '';
        if (bootstrap.metadata) {
          lastSavedAt = bootstrap.metadata.updatedAt;
        }
      } else {
        void loadSession(sessionId);
      }
    }

    // --- Theme mode ---
    try {
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') {
        themeMode = savedTheme;
      }
    } catch {
      // localStorage unavailable — follow system preference
    }

    // --- Layout mode ---
    try {
      const savedLayout = localStorage.getItem(LAYOUT_KEY);
      if (savedLayout === 'side-by-side' || savedLayout === 'unified') {
        layoutMode = savedLayout;
      }
    } catch {
      // localStorage unavailable — default to side-by-side
    }

    // --- Auto-save setup ---
    if (!isReadOnly) {
      autosave = createAutosave({
        initialContent: { original, modified, title },
        onStateChange: (state) => {
          saveState = state;
          if (state === 'readonly') isReadOnly = true;
        },
        onSessionCreated: (id, token) => {
          editToken = token;
          storeToken(id, token);
          history.replaceState(null, '', '/' + id);
          showToast('Auto-saved — share via the Share button', { type: 'success', durationMs: 5000 });
        },
        onSaved: (metadata) => {
          lastSavedAt = metadata.updatedAt;
        },
      });
    } else {
      saveState = 'readonly';
    }

    // --- Keyboard shortcuts ---
    const cleanupShortcuts = setupShortcuts({
      onSave() {
        if (autosave && !isReadOnly) {
          void autosave.flush();
        }
      },
      onCopyRichText() {
        void handleCopyRichText();
      },
      onToggleLayout() {
        handleToggleLayout();
      },
      onDismiss() {
        dismissToast();
      },
    });

    return () => {
      cleanupShortcuts();
      autosave?.destroy();
      clearTimeout(toastTimer);
      clearTimeout(deleteUndoTimer);
    };
  });

  // ─── Reactive auto-save ─────────────────────────────────────────────────────

  $effect(() => {
    const o = original;
    const m = modified;
    const t = title;

    if (autosave && sessionId) {
      autosave.save(sessionId, o, m, t, editToken);
    }
  });

  // ─── Session loading ────────────────────────────────────────────────────────

  async function loadSession(id: string): Promise<void> {
    try {
      const data = await getSession(id);
      if (data) {
        original = data.original;
        modified = data.modified;
        title = data.title ?? '';
        if (data.metadata) {
          lastSavedAt = data.metadata.updatedAt;
        }
      } else {
        showToast('Session not found or expired');
        history.replaceState(null, '', '/');
        sessionId = nanoid(12);
        editToken = null;
        isReadOnly = false;
        original = PLACEHOLDER.original;
        modified = PLACEHOLDER.modified;
        title = '';
        saveState = 'idle';

        autosave?.destroy();
        autosave = createAutosave({
          initialContent: { original, modified, title },
          onStateChange(state) {
            saveState = state;
            if (state === 'readonly') isReadOnly = true;
          },
          onSessionCreated(newId, token) {
            editToken = token;
            storeToken(newId, token);
            history.replaceState(null, '', `/${newId}`);
            showToast('Auto-saved — share via the Share button', { type: 'success', durationMs: 5000 });
          },
          onSaved(metadata) {
            lastSavedAt = metadata.updatedAt;
          },
        });
      }
    } catch {
      showToast('Failed to load session', { type: 'error' });
    }
  }

  // ─── Event handlers ─────────────────────────────────────────────────────────

  function handleChange(side: 'a' | 'b', content: string) {
    if (side === 'a') original = content;
    else modified = content;
  }

  function handleMobileChange(content: string) {
    modified = content;
  }

  function handleStats(newStats: DiffStats) {
    stats = newStats;
  }

  function handleTitleChange(newTitle: string) {
    title = newTitle;
  }

  // ─── Action handlers ──────────────────────────────────────────────────────

  /** Navigate to root for a fresh session. */
  function handleNew(): void {
    window.location.href = '/';
  }

  /** Swap original and modified. */
  function handleSwap(): void {
    const temp = original;
    original = modified;
    modified = temp;
  }

  /** Toggle collapse of unchanged regions. */
  function handleToggleCollapse(): void {
    isCollapsed = !isCollapsed;
    activeEditor()?.setCollapse(isCollapsed);
  }

  /** Toggle between side-by-side and unified layout. */
  function handleToggleLayout(): void {
    layoutMode = layoutMode === 'side-by-side' ? 'unified' : 'side-by-side';
    try { localStorage.setItem(LAYOUT_KEY, layoutMode); } catch { /* best effort */ }
    // Reset collapse when switching layouts — the new component starts fresh
    isCollapsed = false;
  }

  /** Download unified diff. */
  function handleExportDiff(): void {
    downloadUnifiedDiff(original, modified, title || undefined);
  }

  /** Download HTML diff. */
  function handleExportHtml(): void {
    downloadHtml(original, modified, title || undefined);
  }

  /** Print to PDF. */
  function handleExportPdf(): void {
    printPdf();
  }

  /** Copy rich text diff to clipboard. */
  async function handleCopyRichText(): Promise<void> {
    const ok = await copyRichText(original, modified, title || undefined);
    if (ok) {
      showToast('Copied!', { type: 'success' });
    } else {
      showToast('Failed to copy', { type: 'error' });
    }
  }

  // ─── Share ──────────────────────────────────────────────────────────────────

  /**
   * Ensure the current content is saved and we have a session ID.
   * Returns true if ready to share, false if save failed.
   */
  async function ensureSessionSaved(): Promise<boolean> {
    if (editToken) return true;

    // Flush autosave to create the session
    if (autosave) {
      autosave.save(sessionId, original, modified, title, editToken);
      await autosave.flush();
    }

    return editToken !== null;
  }

  /** Share handler — copies edit or read-only link. */
  async function handleShare(type: 'edit' | 'readonly'): Promise<void> {
    const ready = await ensureSessionSaved();
    if (!ready) {
      showToast('Save first to share', { type: 'error' });
      return;
    }

    if (type === 'edit') {
      const url = `${window.location.origin}/${sessionId}#token=${editToken}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Edit link copied!', { type: 'success' });
      } catch {
        showToast('Failed to copy link', { type: 'error' });
      }
    } else {
      const url = `${window.location.origin}/${sessionId}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Read-only link copied!', { type: 'success' });
      } catch {
        showToast('Failed to copy link', { type: 'error' });
      }
    }
  }

  // ─── Fork ───────────────────────────────────────────────────────────────────

  /**
   * Create a new session with the given content. Handles Turnstile.
   * Returns new session info, or `null` on failure.
   */
  async function createNewSession(
    orig: string,
    mod: string,
    sessionTitle?: string,
  ): Promise<{ id: string; editToken: string } | null> {
    try {
      const newId = nanoid(12);
      let turnstileToken: string | null | undefined;
      if (isTurnstileConfigured()) {
        turnstileToken = await getTurnstileToken();
      }
      const result = await saveSession(newId, orig, mod, sessionTitle, undefined, turnstileToken);
      if ('editToken' in result) {
        const created = result as CreateResponse;
        storeToken(newId, created.editToken);
        return { id: newId, editToken: created.editToken };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Fork: create new session with current content. */
  async function handleFork(): Promise<void> {
    const created = await createNewSession(original, modified, title || undefined);
    if (!created) {
      showToast('Failed to fork session', { type: 'error' });
      return;
    }
    window.location.href = `/${created.id}`;
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  /** Delete with confirm and 10-second undo window. */
  async function handleDelete(): Promise<void> {
    if (!editToken) return;

    if (!confirm('Delete this session? You\'ll have 10 seconds to undo.')) {
      return;
    }

    // Hold content for undo
    const savedOriginal = original;
    const savedModified = modified;
    const savedTitle = title;
    const savedSessionId = sessionId;

    try {
      await deleteSession(savedSessionId, editToken);
    } catch {
      showToast('Failed to delete session', { type: 'error' });
      return;
    }

    // Clean up
    removeToken(savedSessionId);
    autosave?.destroy();
    autosave = undefined;

    deleteUndoOriginal = savedOriginal;
    deleteUndoModified = savedModified;
    deleteUndoTitle = savedTitle;

    showToast('Session deleted.', {
      type: 'info',
      durationMs: DELETE_UNDO_MS + 1000,
      action: {
        label: 'Undo',
        handler: () => { void handleDeleteUndo(); },
      },
    });

    clearTimeout(deleteUndoTimer);
    deleteUndoTimer = setTimeout(() => {
      if (undoInProgress) return; // undo is in-flight — don't navigate
      deleteUndoOriginal = null;
      deleteUndoModified = null;
      deleteUndoTitle = null;
      dismissToast();
      window.location.href = '/';
    }, DELETE_UNDO_MS);
  }

  /** Undo a delete: re-create session with held content. */
  async function handleDeleteUndo(): Promise<void> {
    undoInProgress = true;
    clearTimeout(deleteUndoTimer);
    dismissToast();

    const orig = deleteUndoOriginal;
    const mod = deleteUndoModified;
    const savedTitle = deleteUndoTitle;
    deleteUndoOriginal = null;
    deleteUndoModified = null;
    deleteUndoTitle = null;

    if (!orig || !mod) {
      window.location.href = '/';
      return;
    }

    const created = await createNewSession(orig, mod, savedTitle ?? undefined);
    if (!created) {
      showToast('Failed to restore session', { type: 'error' });
      setTimeout(() => { window.location.href = '/'; }, 2000);
      return;
    }
    window.location.href = `/${created.id}`;
  }

  // ─── Theme toggle ──────────────────────────────────────────────────────────

  function getEffectiveTheme(): 'light' | 'dark' {
    if (themeMode !== 'system') return themeMode;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function handleThemeToggle(): void {
    let next: ThemeMode;
    if (themeMode === 'system') {
      next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    } else if (themeMode === 'dark') {
      next = 'light';
    } else {
      next = 'system';
    }
    themeMode = next;

    if (next === 'system') {
      document.documentElement.removeAttribute('data-theme');
      try { localStorage.removeItem(THEME_KEY); } catch { /* best effort */ }
    } else {
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch { /* best effort */ }
    }
  }
</script>

<div class="app">
  <Toolbar
    {stats}
    {saveState}
    {isReadOnly}
    {isNarrow}
    {isCollapsed}
    {title}
    {layoutMode}
    {lastSavedAt}
    {sizeWarning}
    {contentSize}
    onTitleChange={handleTitleChange}
    onNew={handleNew}
    onSwap={handleSwap}
    onToggleCollapse={handleToggleCollapse}
    onToggleLayout={handleToggleLayout}
    onExportDiff={handleExportDiff}
    onExportHtml={handleExportHtml}
    onExportPdf={handleExportPdf}
    onCopyRichText={() => { void handleCopyRichText(); }}
    onShare={(type) => { void handleShare(type); }}
    onFork={() => { void handleFork(); }}
    onDelete={() => { void handleDelete(); }}
    onToggleTheme={handleThemeToggle}
    {themeMode}
  />

  <main class="editor-area" data-pane="diff">
    {#if isNarrow}
      <MobileDiff bind:this={mobileDiff} {original} {modified} readonly={isReadOnly} onchange={handleMobileChange} onstats={handleStats} />
    {:else if layoutMode === 'unified'}
      <MobileDiff
        bind:this={mobileDiff}
        {original}
        {modified}
        readonly={isReadOnly}
        onchange={handleMobileChange}
        onstats={handleStats}
      />
    {:else}
      <DiffEditor
        bind:this={diffEditor}
        {original}
        {modified}
        readonly={isReadOnly}
        {stats}
        onchange={handleChange}
        onstats={handleStats}
      />
    {/if}
  </main>

  <!-- Toast notification -->
  {#if toastMessage}
    <div class="toast toast-{toastType}" role="alert">
      <span class="toast-text">{toastMessage}</span>
      {#if toastAction}
        <button class="toast-action" onclick={toastAction.handler}>
          {toastAction.label}
        </button>
      {/if}
      <button class="toast-dismiss" onclick={dismissToast} aria-label="Dismiss">&times;</button>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
    background: var(--surface);
    color: var(--text);
    position: relative;
  }

  .editor-area {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
  }

  /* ── Toast ── */

  .toast {
    position: fixed;
    bottom: var(--space-6);
    left: 50%;
    transform: translateX(-50%);
    background: var(--text);
    color: var(--surface);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    z-index: var(--z-toast);
    /* Shadow exception: toast floats above content — needs visual lift
       even though the design system is borders-only for in-page surfaces */
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: toast-in 200ms ease-out;
    max-width: calc(100vw - 48px);
    border: 1px solid var(--border);
  }

  .toast-success {
    background: var(--status-success);
    color: var(--text-inverse);
  }

  .toast-error {
    background: var(--status-error);
    color: var(--text-inverse);
  }

  .toast-text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toast-action {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: var(--radius-sm);
    color: inherit;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    padding: 2px var(--space-2);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color var(--duration-fast) ease-out;
  }

  .toast-action:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .toast-dismiss {
    background: none;
    border: none;
    color: inherit;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0 2px;
    opacity: 0.7;
    line-height: 1;
  }

  .toast-dismiss:hover {
    opacity: 1;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
