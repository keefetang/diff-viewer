/** Save state indicator. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'readonly';

/** Theme preference: follow system, or force light/dark. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** Layout mode for the diff view. */
export type LayoutMode = 'side-by-side' | 'unified';

/** Content size relative to the server limit. */
export type SizeWarning = 'ok' | 'warning' | 'critical';

/** Server-enforced max content size for the JSON payload (1 MB). */
export const MAX_CONTENT_SIZE = 1_048_576;

/** Diff statistics computed from CM6 chunks. */
export interface DiffStats {
  additions: number;
  deletions: number;
  chunks: number;
  originalLines: number;
  modifiedLines: number;
}
