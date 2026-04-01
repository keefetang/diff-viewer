/**
 * Shared types and utilities for the Worker layer.
 *
 * Pure types and functions only — no Cloudflare bindings, no side effects.
 * Each Worker file declares its own narrowed `Env` interface (principle of
 * least privilege); this module holds the common bits.
 */

// ---------------------------------------------------------------------------
// Re-exports — isomorphic utilities shared with the client
// ---------------------------------------------------------------------------

export { escapeForHtml, escapeText } from '../shared/escape';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  createdAt: number;
  updatedAt: number;
  editToken: string;
}

/** The shape of a diff session stored in KV. */
export interface DiffSessionValue {
  original: string;
  modified: string;
  title?: string;
}
