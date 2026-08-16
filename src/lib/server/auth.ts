/**
 * Authentication & session primitives.
 *
 * - Passwords: PBKDF2-SHA256 via Web Crypto (works on Node and Cloudflare
 *   Workers) with per-user random salt and a high iteration count.
 * - Sessions: random 32-byte tokens stored server-side; the cookie holds the
 *   token plus an HMAC signature so values can't be forged or tampered with.
 * - CSRF: state-changing requests are rejected unless they are same-origin
 *   (Origin / Sec-Fetch-Site checks), and cookies are SameSite=Lax.
 *
 * No custom cryptography is invented — everything uses platform primitives.
 */
import type { Session, User } from '../types';
import type { Store } from './store';

export const SESSION_COOKIE = 'zenith_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 310_000;
const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-SHA256)
// ---------------------------------------------------------------------------

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']),
    256,
  );
  return { hash: toHex(bits), salt: toHex(salt), iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password: string, stored: User): Promise<boolean> {
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(stored.salt) as unknown as BufferSource,
      iterations: stored.iterations,
    },
    await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']),
    256,
  );
  const candidate = toHex(bits);
  return constantTimeEqual(candidate, stored.passwordHash);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// Session tokens & cookies
// ---------------------------------------------------------------------------

function authSecret(): string {
  const secret = import.meta.env.AUTH_SECRET;
  if (!secret) {
    // Dev fallback — a stable random value per process. Production must set
    // AUTH_SECRET (a Cloudflare secret binding) or sessions will not persist
    // across redeploys.
    if (import.meta.env.DEV) return 'dev-only-insecure-secret';
    throw new Error('AUTH_SECRET is not configured.');
  }
  return secret;
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(authSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return toHex(sig);
}

export async function createSessionToken(sessionId: string): Promise<string> {
  const sig = await sign(sessionId);
  return `${sessionId}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await sign(sessionId);
  return constantTimeEqual(sig, expected) ? sessionId : null;
}

export function cookieAttributes(request: Request, value = '', maxAgeSeconds = SESSION_TTL_MS / 1000): string {
  const secure = !import.meta.env.DEV && request.url.startsWith('https://');
  return [
    `${SESSION_COOKIE}=${value}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function deleteCookie(request: Request): string {
  const secure = !import.meta.env.DEV && request.url.startsWith('https://');
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ');
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function createSession(store: Store, userId: string, request: Request): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const session: Session = {
    id: token,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    ip: request.headers.get('cf-connecting-ip') ?? undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? undefined,
  };
  await store.mutate((db) => {
    db.sessions = db.sessions.filter((s) => s.expiresAt > new Date().toISOString());
    db.sessions.push(session);
  });
  return createSessionToken(token);
}

export async function getSessionUser(store: Store, request: Request): Promise<User | null> {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return null;
  const sessionId = await verifySessionToken(raw);
  if (!sessionId) return null;
  const db = store.db();
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  const user = db.users.find((u) => u.id === session.userId);
  if (!user || user.suspended) return null;
  return user;
}

export async function destroySession(store: Store, request: Request): Promise<void> {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return;
  const sessionId = await verifySessionToken(raw);
  if (!sessionId) return;
  await store.mutate((db) => {
    db.sessions = db.sessions.filter((s) => s.id !== sessionId);
  });
}

// ---------------------------------------------------------------------------
// CSRF / same-origin enforcement
// ---------------------------------------------------------------------------

/**
 * Reject state-changing requests that did not originate from this site.
 * Cross-origin browsers send an Origin header on POST; native clients may not,
 * in which case Sec-Fetch-Site (when present) must be same-origin.
 */
export function isSameOrigin(request: Request): boolean {
  // Same-origin browsers always send an Origin header on POST; cross-site
  // requests reveal the attacker's origin and are rejected. Native clients
  // (CLI, launchers) may send neither header — with SameSite=Lax cookies in
  // place there is no browser CSRF vector for them, so they are allowed.
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const host = new URL(origin).host;
      const self = new URL(request.url).host;
      return host === self;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  return true;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLE_RANK: Record<string, number> = {
  user: 0,
  moderator: 1,
  support: 1,
  admin: 2,
  owner: 3,
};

export function canManage(actor: User, targetRole: string): boolean {
  return ROLE_RANK[actor.role] > ROLE_RANK[targetRole];
}
