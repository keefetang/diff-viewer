import { nanoid } from 'nanoid';
import { timingSafeEqual, sessionHeaders, checkIfNoneMatch, computeExpiresAt } from './shared';
import type { DiffSessionValue, SessionMetadata } from './shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  SESSIONS: KVNamespace;
  // Rate limiting is optional — the Deploy to Cloudflare button may not
  // auto-provision rate limit bindings. When absent, the app functions
  // without rate limiting (Turnstile + edit tokens are the primary defenses).
  WRITE_LIMITER?: RateLimit;
  READ_LIMITER?: RateLimit;
  TURNSTILE_SECRET_KEY?: string;
  CORS_ORIGIN?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID_RE = /^[A-Za-z0-9_-]{12}$/;
const MAX_CONTENT_LENGTH = 1_048_576; // 1 MB — allows two 512 KB texts + title
const EXPIRATION_TTL = 7_776_000;       // 90 days — browser-created sessions
const AGENT_EXPIRATION_TTL = 2_592_000; // 30 days — agent/script-created sessions (no Turnstile)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Headers,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(corsHeaders),
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status: number, corsHeaders: Headers): Response {
  return jsonResponse({ error: message }, status, corsHeaders);
}

function corsHeaders(env: Env): Headers {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', env.CORS_ORIGIN || '*');
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Edit-Token, X-Private, If-Match, If-None-Match, If-Modified-Since');
  headers.set('Access-Control-Expose-Headers', 'ETag, Last-Modified, X-Expires-At');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

/**
 * Extract the session ID from a `/api/sessions/:id` path.
 * Returns `null` if the path doesn't match the expected pattern.
 */
function extractSessionId(pathname: string): string | null {
  const prefix = '/api/sessions/';
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length);
  // Reject if there's anything after the ID (e.g. trailing slashes or sub-paths)
  if (id.includes('/')) return null;
  return id || null;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Check a rate limiter binding keyed on the client IP.
 * Returns a 429 Response if the limit is exceeded, or `null` to proceed.
 * When the limiter binding is not provisioned, returns `null` (allow).
 */
async function checkRateLimit(
  limiter: RateLimit | undefined,
  request: Request,
  cors: Headers,
): Promise<Response | null> {
  if (!limiter) return null;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await limiter.limit({ key: ip });
  if (!success) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Retry-After': '60',
      ...Object.fromEntries(cors),
    });
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers,
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Turnstile verification
// ---------------------------------------------------------------------------

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Turnstile token via the siteverify API.
 * Returns `true` if verification passes or if the Turnstile service is
 * unreachable (fail-open for availability — rate limiting is the fallback).
 * Returns `false` only when the service explicitly rejects the token.
 */
async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteIp: string,
): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append('secret', secretKey);
    formData.append('response', token);
    formData.append('remoteip', remoteIp);

    const result = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: formData,
    });
    const outcome = await result.json<{ success: boolean }>();
    return outcome.success === true;
  } catch (err) {
    // Turnstile infrastructure unavailable — fail open for availability.
    // Rate limiting is the secondary defense if Turnstile is down.
    console.error(JSON.stringify({
      message: 'turnstile verification failed',
      error: err instanceof Error ? err.message : String(err),
    }));
    return true;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an OPTIONS preflight response with CORS headers.
 */
export function handleCorsPreflight(env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env),
  });
}

/**
 * Handle all `/api/*` requests. CORS preflight (OPTIONS) is handled by
 * the caller in index.ts — this function handles GET, PUT, DELETE.
 */
export async function handleApi(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(env);
  const url = new URL(request.url);
  const { pathname } = url;

  try {
    // --- Extract & validate session ID ---
    const id = extractSessionId(pathname);
    if (id === null) {
      return errorResponse('Not found', 404, cors);
    }
    if (!SESSION_ID_RE.test(id)) {
      return errorResponse('Invalid session ID', 400, cors);
    }

    // --- Rate limiting ---
    const isWrite = request.method === 'PUT' || request.method === 'DELETE';
    const limiter = isWrite ? env.WRITE_LIMITER : env.READ_LIMITER;
    const rateLimited = await checkRateLimit(limiter, request, cors);
    if (rateLimited) return rateLimited;

    // --- Route by method ---
    switch (request.method) {
      case 'GET':
        return await handleGet(id, request, env, cors);
      case 'PUT':
        return await handlePut(id, request, env, cors);
      case 'DELETE':
        return await handleDelete(id, request, env, cors);
      default:
        return errorResponse('Method not allowed', 405, cors);
    }
  } catch (err) {
    console.error(JSON.stringify({
      message: 'api error',
      error: err instanceof Error ? err.message : String(err),
      path: pathname,
    }));
    return errorResponse('Internal server error', 500, cors);
  }
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

async function handleGet(
  id: string,
  request: Request,
  env: Env,
  cors: Headers,
): Promise<Response> {
  const { value, metadata } =
    await env.SESSIONS.getWithMetadata<SessionMetadata>(id);

  if (value === null || metadata === null) {
    return errorResponse('Session not found', 404, cors);
  }

  // Private sessions require a valid edit token to view — return 404 (not
  // 403) to avoid revealing that the session exists.
  if (metadata.private) {
    const editTokenHeader = request.headers.get('X-Edit-Token');
    if (!editTokenHeader || !timingSafeEqual(editTokenHeader, metadata.editToken)) {
      return errorResponse('Session not found', 404, cors);
    }
  }

  // Conditional retrieval — 304 when client already has current version.
  // Checked after auth so private sessions don't leak existence via 304.
  if (checkIfNoneMatch(request, metadata.updatedAt)) {
    return new Response(null, {
      status: 304,
      headers: {
        ...Object.fromEntries(cors),
        ...sessionHeaders(metadata),
      },
    });
  }

  // KV value is a JSON-serialized DiffSessionValue
  let session: DiffSessionValue;
  try {
    session = JSON.parse(value) as DiffSessionValue;
  } catch {
    return errorResponse('Session not found', 404, cors);
  }

  return jsonResponse(
    {
      id,
      original: session.original,
      modified: session.modified,
      title: session.title,
      metadata: {
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      },
      private: !!metadata.private,
      expiresAt: computeExpiresAt(metadata),
    },
    200,
    cors,
    sessionHeaders(metadata),
  );
}

async function handlePut(
  id: string,
  request: Request,
  env: Env,
  cors: Headers,
): Promise<Response> {
  // --- Content-Type validation ---
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return errorResponse('Unsupported Media Type', 415, cors);
  }

  // --- Content-Length pre-check (reject before reading body) ---
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isNaN(length) && length > MAX_CONTENT_LENGTH) {
      return errorResponse('Payload too large', 413, cors);
    }
  }

  // --- Parse body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400, cors);
  }

  if (typeof body !== 'object' || body === null) {
    return errorResponse('Invalid request body', 400, cors);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.original !== 'string' || typeof record.modified !== 'string') {
    return errorResponse('Invalid request body', 400, cors);
  }
  const original = record.original;
  const modified = record.modified;
  const title = typeof record.title === 'string' ? record.title : undefined;

  // --- Binary content detection (null byte check) ---
  if (original.includes('\0') || modified.includes('\0') || (title && title.includes('\0'))) {
    return errorResponse('Binary content is not supported', 400, cors);
  }

  // --- Double-check content size after parsing ---
  const encoder = new TextEncoder();
  const sessionValue: DiffSessionValue = { original, modified, title };
  const serialized = JSON.stringify(sessionValue);
  if (encoder.encode(serialized).byteLength > MAX_CONTENT_LENGTH) {
    return errorResponse('Payload too large', 413, cors);
  }

  // --- Load existing session ---
  const { value: existingValue, metadata: existingMeta } =
    await env.SESSIONS.getWithMetadata<SessionMetadata>(id);

  const editTokenHeader = request.headers.get('X-Edit-Token');

  // CREATE: no token + session doesn't exist → generate editToken, store, return 201
  if (existingValue === null && !editTokenHeader) {
    // --- Turnstile verification (only on creation, only if configured) ---
    // Turnstile is a fast-pass, not a gate. If a token is present, verify it
    // (reject fakes). If absent, skip — rate limiting is the fallback.
    // This allows agents/scripts to create sessions without a browser.
    const turnstileToken = typeof record.turnstileToken === 'string' ? record.turnstileToken : null;
    let hasTurnstile = false;

    if (env.TURNSTILE_SECRET_KEY && turnstileToken) {
      const remoteIp = request.headers.get('cf-connecting-ip') || '';
      const valid = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, remoteIp);
      if (!valid) {
        return errorResponse('Bot verification failed', 403, cors);
      }
      hasTurnstile = true;
    }

    const now = Date.now();
    const editToken = nanoid(24);
    // Private flag: from JSON body or X-Private header (agents may prefer headers over body fields)
    const isPrivate = typeof record.private === 'boolean'
      ? record.private
      : request.headers.get('X-Private') === 'true';
    // Browser sessions (Turnstile verified): 90 days. Agent sessions: 30 days.
    const ttl = hasTurnstile ? EXPIRATION_TTL : AGENT_EXPIRATION_TTL;
    const metadata: SessionMetadata = {
      createdAt: now,
      updatedAt: now,
      editToken,
      private: isPrivate,
      ttl,
    };

    await env.SESSIONS.put(id, serialized, {
      metadata,
      expirationTtl: ttl,
    });

    // Build share URLs for the response
    const origin = new URL(request.url).origin;
    return jsonResponse(
      {
        id,
        metadata: { createdAt: now, updatedAt: now },
        editToken,
        private: isPrivate,
        url: `${origin}/${id}`,
        editUrl: `${origin}/${id}#token=${editToken}`,
        expiresAt: computeExpiresAt(metadata),
      },
      201,
      cors,
      sessionHeaders(metadata),
    );
  }

  // Session exists — verify edit token
  if (existingValue !== null && existingMeta !== null) {
    if (!editTokenHeader || !timingSafeEqual(editTokenHeader, existingMeta.editToken)) {
      // FORBIDDEN: no/invalid token + session exists
      return errorResponse('Forbidden', 403, cors);
    }

    // UPDATE: valid token + session exists → reset TTL (preserved tier), return 200
    const now = Date.now();
    // If `private` is explicitly set in the body, update it; otherwise preserve existing
    // If `private` is explicitly set (JSON body or X-Private header), update; otherwise preserve
    const privateHeader = request.headers.get('X-Private');
    const isPrivate = typeof record.private === 'boolean'
      ? record.private
      : privateHeader !== null
        ? privateHeader === 'true'
        : !!existingMeta.private;
    // Preserve the original TTL tier (browser 90d vs agent 30d)
    const ttl = existingMeta.ttl ?? EXPIRATION_TTL;
    const metadata: SessionMetadata = {
      createdAt: existingMeta.createdAt,
      updatedAt: now,
      editToken: existingMeta.editToken,
      private: isPrivate,
      ttl,
    };

    await env.SESSIONS.put(id, serialized, {
      metadata,
      expirationTtl: ttl,
    });

    return jsonResponse(
      {
        id,
        metadata: { createdAt: existingMeta.createdAt, updatedAt: now },
        private: isPrivate,
        expiresAt: computeExpiresAt(metadata),
      },
      200,
      cors,
      sessionHeaders(metadata),
    );
  }

  // Edge case: token provided but session doesn't exist
  return errorResponse('Session not found', 404, cors);
}

async function handleDelete(
  id: string,
  request: Request,
  env: Env,
  cors: Headers,
): Promise<Response> {
  const editTokenHeader = request.headers.get('X-Edit-Token');
  if (!editTokenHeader) {
    return errorResponse('Forbidden', 403, cors);
  }

  const { value: existingValue, metadata: existingMeta } =
    await env.SESSIONS.getWithMetadata<SessionMetadata>(id);

  if (existingValue === null || existingMeta === null) {
    return errorResponse('Session not found', 404, cors);
  }

  if (!timingSafeEqual(editTokenHeader, existingMeta.editToken)) {
    return errorResponse('Forbidden', 403, cors);
  }

  await env.SESSIONS.delete(id);

  return new Response(null, {
    status: 204,
    headers: Object.fromEntries(cors),
  });
}
