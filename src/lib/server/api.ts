/**
 * Helpers for API routes (src/pages/api/**).
 * All endpoints funnel through these so error handling and security headers
 * stay consistent and no stack traces ever leak to clients.
 */
import type { APIContext } from 'astro';
import type { User } from '../types';
import type { Store } from './store';
import { getSessionUser, isSameOrigin } from './auth';
import { getStore, StorageNotConfiguredError } from './store';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export function ok(body: unknown = { ok: true }): Response {
  return json(body);
}

export function fail(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ ok: false, error: error.code, message: error.message }, error.status);
  }
  if (error instanceof StorageNotConfiguredError) {
    return json(
      { ok: false, error: 'backend_not_configured', message: 'The backend for this feature is not configured yet.' },
      503,
    );
  }
  console.error('[api] unexpected error:', error);
  return json({ ok: false, error: 'internal_error', message: 'Something went wrong. Please try again.' }, 500);
}

/** Same-origin guard for state-changing requests (CSRF). */
export function requireSameOrigin(ctx: APIContext): void {
  if (!isSameOrigin(ctx.request)) {
    throw new ApiError(403, 'forbidden', 'Cross-origin requests are not allowed.');
  }
}

export async function requireStore(): Promise<Store> {
  return getStore();
}

export async function requireUser(ctx: APIContext): Promise<{ user: User; store: Store }> {
  const store = await getStore();
  const user = await getSessionUser(store, ctx.request);
  if (!user) {
    throw new ApiError(401, 'unauthenticated', 'You must be signed in to do that.');
  }
  return { user, store };
}

export async function requireAdmin(ctx: APIContext): Promise<{ user: User; store: Store }> {
  const { user, store } = await requireUser(ctx);
  if (user.role !== 'admin' && user.role !== 'owner') {
    throw new ApiError(403, 'forbidden', 'Administrator access is required.');
  }
  return { user, store };
}

/** Parse a JSON body, rejecting invalid payloads. */
export async function readJson<T>(ctx: APIContext): Promise<T> {
  try {
    const data = await ctx.request.json();
    if (typeof data !== 'object' || data === null) throw new Error('not an object');
    return data as T;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

/** Accept either a JSON body or a classic HTML form submission. */
export async function readPayload(ctx: APIContext): Promise<Record<string, unknown>> {
  const contentType = ctx.request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return readJson(ctx);
  }
  try {
    const form = await ctx.request.formData();
    const out: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      out[key] = typeof value === 'string' ? value : value;
    }
    return out;
  } catch {
    throw new ApiError(400, 'invalid_form', 'Request body must be valid form data.');
  }
}

/** PRG-style redirect response with security headers. */
export function redirectTo(_ctx: APIContext, location: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'owner';
}
