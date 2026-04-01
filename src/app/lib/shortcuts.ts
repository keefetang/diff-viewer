/**
 * Keyboard shortcut handling.
 *
 * Registers global keydown listeners for app-wide shortcuts.
 * Provides setup/teardown for Svelte component lifecycle.
 *
 * All shortcuts use Cmd (Mac) or Ctrl (Windows/Linux) as the modifier.
 */

export interface ShortcutHandlers {
  /** Cmd/Ctrl+S — force save (flush auto-save) */
  onSave: () => void;
  /** Cmd/Ctrl+Shift+D — copy rich text diff to clipboard */
  onCopyRichText: () => void;
  /** Alt+↓ — navigate to next diff chunk */
  onNextChunk: () => void;
  /** Alt+↑ — navigate to previous diff chunk */
  onPrevChunk: () => void;
  /** Cmd/Ctrl+Shift+L — toggle layout (side-by-side ↔ unified) */
  onToggleLayout?: () => void;
  /** Esc — dismiss toasts, close popovers */
  onDismiss: () => void;
}

/**
 * Set up global keyboard shortcuts. Returns a cleanup function
 * for use in Svelte's onMount return or onDestroy.
 */
export function setupShortcuts(handlers: ShortcutHandlers): () => void {
  function handleKeydown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl+S — save
    if (mod && !e.shiftKey && e.key === 's') {
      e.preventDefault();
      handlers.onSave();
      return;
    }

    // Cmd/Ctrl+Shift+D — copy rich text diff
    if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      handlers.onCopyRichText();
      return;
    }

    // Cmd/Ctrl+Shift+L — toggle layout
    if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      handlers.onToggleLayout?.();
      return;
    }

    // Alt+↓ — next chunk
    if (e.altKey && !mod && e.key === 'ArrowDown') {
      e.preventDefault();
      handlers.onNextChunk();
      return;
    }

    // Alt+↑ — prev chunk
    if (e.altKey && !mod && e.key === 'ArrowUp') {
      e.preventDefault();
      handlers.onPrevChunk();
      return;
    }

    // Esc — dismiss
    if (e.key === 'Escape') {
      handlers.onDismiss();
      return;
    }
  }

  window.addEventListener('keydown', handleKeydown);

  return () => {
    window.removeEventListener('keydown', handleKeydown);
  };
}
