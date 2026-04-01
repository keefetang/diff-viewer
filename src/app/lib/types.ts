export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'readonly';
export type ThemeMode = 'system' | 'light' | 'dark';
export type LayoutMode = 'side-by-side' | 'unified';
export type SizeWarning = 'ok' | 'warning' | 'critical';

/** Server-enforced max content size for the JSON payload (1 MB). */
export const MAX_CONTENT_SIZE = 1_048_576;

export interface DiffStats {
  additions: number;
  deletions: number;
  chunks: number;
  originalLines: number;
  modifiedLines: number;
}
