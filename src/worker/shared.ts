/**
 * Shared types and utilities for the Worker layer.
 *
 * Pure types and functions only — no Cloudflare bindings, no side effects.
 * Each Worker file declares its own narrowed `Env` interface (principle of
 * least privilege); this module holds the common bits.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  createdAt: number;
  updatedAt: number;
  editToken: string;
  /** When true, viewing requires a valid edit token. Absent/false = public. */
  private?: boolean;
  /** KV TTL in seconds. Set at creation, preserved on update.
   *  Browser sessions (Turnstile verified): 90 days.
   *  Agent sessions (no Turnstile): 30 days. */
  ttl?: number;
}

/** The shape of a diff session stored in KV. */
export interface DiffSessionValue {
  original: string;
  modified: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Token comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison using the Workers-native implementation.
 * Edit tokens are always nanoid(24) so lengths always match in practice.
 * A length mismatch returns false immediately — acceptable since it already
 * reveals the token is wrong without leaking content information.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  // Workers runtime provides timingSafeEqual on SubtleCrypto, but the DOM
  // lib's type definition doesn't include it — cast to access it.
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Session response headers
// ---------------------------------------------------------------------------

/**
 * Generate common metadata headers for session responses.
 *
 * Every session response (GET, PUT, content-negotiation) carries these
 * headers so agents can cache, revalidate, and track document freshness.
 *
 * - `ETag`: weak ETag from `updatedAt` — `W/"<updatedAt>"`
 * - `Last-Modified`: HTTP date from `updatedAt`
 * - `X-Expires-At`: HTTP date from `updatedAt + ttl * 1000` (omitted when `ttl` is undefined)
 * - `Vary: Accept`: content-negotiation signal — `/:id` returns HTML or
 *   plain text depending on the `Accept` header
 */
export function sessionHeaders(metadata: SessionMetadata): Record<string, string> {
  const headers: Record<string, string> = {
    'ETag': `W/"${metadata.updatedAt}"`,
    'Last-Modified': new Date(metadata.updatedAt).toUTCString(),
    'Vary': 'Accept',
  };

  if (metadata.ttl !== undefined) {
    headers['X-Expires-At'] = new Date(metadata.updatedAt + metadata.ttl * 1000).toUTCString();
  }

  return headers;
}

/**
 * Compute the ISO date string when a session expires, based on its
 * last update timestamp and TTL. Returns undefined when TTL is absent
 * (legacy sessions).
 */
export function computeExpiresAt(metadata: SessionMetadata): string | undefined {
  if (metadata.ttl === undefined) return undefined;
  return new Date(metadata.updatedAt + metadata.ttl * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Conditional request helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an ETag for comparison: strip the `W/` weak indicator and trim
 * whitespace, leaving just the opaque-tag (the quoted string).
 */
export function normalizeETag(tag: string): string {
  return tag.replace(/^W\//, '').trim();
}

/**
 * Check whether a GET request's `If-None-Match` / `If-Modified-Since` headers
 * indicate the client already has the current version (→ 304 Not Modified).
 *
 * Evaluation order per RFC 9110 §13.2.2 (Precedence of Preconditions):
 *   1. If `If-None-Match` is present, compare against the current weak ETag.
 *      Result is authoritative — `If-Modified-Since` is ignored.
 *   2. Otherwise, if `If-Modified-Since` is present, compare against `updatedAt`.
 *
 * Returns `true` when the response should be 304.
 */
export function checkIfNoneMatch(request: Request, updatedAt: number): boolean {
  const ifNoneMatch = request.headers.get('If-None-Match');

  if (ifNoneMatch !== null) {
    const currentETag = `W/"${updatedAt}"`;
    // Weak comparison (RFC 9110 §8.8.3.2): compare opaque-tags after stripping W/ prefix.
    // If-None-Match can be a comma-separated list of ETags.
    return ifNoneMatch.split(',').some((tag) => normalizeETag(tag) === normalizeETag(currentETag));
  }

  const ifModifiedSince = request.headers.get('If-Modified-Since');
  if (ifModifiedSince !== null) {
    const sinceMs = Date.parse(ifModifiedSince);
    if (!Number.isNaN(sinceMs)) {
      // HTTP dates have 1-second resolution; updatedAt is milliseconds.
      // Document is "not modified" when updatedAt ≤ the date the client last saw.
      return updatedAt <= sinceMs;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Re-exports — isomorphic escape utilities from src/shared/escape.ts
// ---------------------------------------------------------------------------

export { escapeForHtml, escapeText } from '../shared/escape';
