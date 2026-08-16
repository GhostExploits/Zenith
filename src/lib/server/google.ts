/**
 * Google OAuth / OIDC via arctic.
 *
 * - Start (`/api/auth/google`): builds the authorization URL with a random
 *   `state`, a PKCE `code_verifier`, and a `nonce`, all stored in a short-lived
 *   HttpOnly cookie. The `state` guards against CSRF; the verifier proves the
 *   callback belongs to our authorization request; the `nonce` is checked
 *   against the ID token to prevent replay.
 * - Callback (`/api/auth/google/callback`): validates the state cookie,
 *   exchanges the code for tokens, decodes and verifies the ID token
 *   (issuer, audience, email_verified, nonce), then links-or-creates the
 *   account server-side and issues a normal session cookie.
 *
 * The client secret never leaves the server.
 */
import { Google, decodeIdToken } from 'arctic';
import type { Store } from './store';
import type { User } from '../types';
import { readCookie } from './auth';

const OAUTH_COOKIE = 'zenith_oauth';
const OAUTH_TTL_MS = 10 * 60 * 1000;
const enc = new TextEncoder();

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = import.meta.env.GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = import.meta.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleConfigured(): boolean {
  return googleConfig() !== null;
}

function randomToken(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function oauthCookie(value: string): string {
  const secure = !import.meta.env.DEV;
  return [
    `${OAUTH_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${Math.floor(OAUTH_TTL_MS / 1000)}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearOauthCookie(): string {
  const secure = !import.meta.env.DEV;
  return [OAUTH_COOKIE + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : '', 'Max-Age=0']
    .filter(Boolean)
    .join('; ');
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

interface OAuthState {
  state: string;
  codeVerifier: string;
  nonce: string;
  next?: string;
}

/** Build the authorization URL and the cookie carrying the OAuth state. */
export function buildGoogleAuthUrl(request: Request): { url: URL; cookie: string } {
  const config = googleConfig();
  if (!config) throw new Error('Google OAuth is not configured.');

  const provider = new Google(config.clientId, config.clientSecret, config.redirectUri);
  const state = randomToken();
  const codeVerifier = randomToken(48);
  const nonce = randomToken();

  const url = provider.createAuthorizationURL(state, codeVerifier, ['openid', 'email', 'profile']);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  const nextParam = new URL(request.url).searchParams.get('next');
  const oauthState: OAuthState = {
    state,
    codeVerifier,
    nonce,
    next: nextParam && nextParam.startsWith('/') ? nextParam.slice(0, 200) : undefined,
  };
  const cookie = oauthCookie(encodeURIComponent(JSON.stringify(oauthState)));
  return { url, cookie };
}

function readOAuthState(request: Request): OAuthState | null {
  const raw = readCookie(request, OAUTH_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as OAuthState;
    if (!parsed.state || !parsed.codeVerifier || !parsed.nonce) return null;
    return parsed;
  } catch {
    return null;
  }
}

function verifyIdToken(idToken: string, clientId: string, nonce: string): GoogleProfile {
  const payload = decodeIdToken(idToken) as Record<string, unknown>;
  const iss = payload.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    throw new Error('Invalid ID token issuer.');
  }
  if (payload.aud !== clientId) throw new Error('Invalid ID token audience.');
  if (payload.nonce !== nonce) throw new Error('Invalid ID token nonce.');
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (exp * 1000 < Date.now()) throw new Error('ID token expired.');
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!sub || !email) throw new Error('ID token is missing required claims.');
  return {
    sub,
    email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 40) : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture.slice(0, 500) : undefined,
  };
}

export type GoogleCallbackResult =
  | { ok: true; profile: GoogleProfile; next?: string; clearCookie: string }
  | { ok: false; code: string; message: string; clearCookie: string };

/**
 * Handle the OAuth callback. Validates the state cookie, exchanges the code,
 * verifies the ID token, and returns the verified Google profile.
 */
export async function handleGoogleCallback(request: Request): Promise<GoogleCallbackResult> {
  const clear = clearOauthCookie();
  const config = googleConfig();
  if (!config) {
    return { ok: false, code: 'oauth_not_configured', message: 'Google sign-in is not configured.', clearCookie: clear };
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const oauthState = readOAuthState(request);
  if (!code || !stateParam || !oauthState) {
    return { ok: false, code: 'oauth_invalid_state', message: 'This sign-in request is invalid or expired. Please try again.', clearCookie: clear };
  }
  // Constant-time compare of the state to avoid leaking timing differences.
  if (!timingSafeEqualString(stateParam, oauthState.state)) {
    return { ok: false, code: 'oauth_invalid_state', message: 'This sign-in request is invalid or expired. Please try again.', clearCookie: clear };
  }

  try {
    const provider = new Google(config.clientId, config.clientSecret, config.redirectUri);
    const tokens = await provider.validateAuthorizationCode(code, oauthState.codeVerifier);
    const profile = verifyIdToken(tokens.idToken(), config.clientId, oauthState.nonce);
    return { ok: true, profile, next: oauthState.next, clearCookie: clear };
  } catch (err) {
    return {
      ok: false,
      code: 'oauth_failed',
      message: 'Google could not complete your sign-in. Please try again.',
      clearCookie: clear,
    };
  }
}

export type GoogleLinkResult =
  | { status: 'ok'; user: User; linked: boolean }
  | { status: 'email_conflict'; message: string };

/**
 * Link-or-create an account from a verified Google profile.
 *
 * Safe rules:
 *  - Existing `googleId` match → sign in.
 *  - Existing account with the same verified email → link the Google identity
 *    to it (single account, multiple sign-in methods).
 *  - Existing account with the same UNVERIFIED email → refuse to link
 *    (never merge based on an unverified email claim).
 *  - No match → create a new account (verified, since Google verified it).
 *
 * Pure against the Store so it can be unit-tested.
 */
export async function linkGoogleIdentity(store: Store, profile: GoogleProfile): Promise<GoogleLinkResult> {
  const db = store.db();

  const byGoogle = db.users.find((u) => u.googleId === profile.sub);
  if (byGoogle) {
    return { status: 'ok', user: byGoogle, linked: false };
  }

  // Case-insensitive: stored emails are normalized at signup, but compare
  // defensively so a legacy/imported row can never produce a duplicate.
  const byEmail = db.users.find((u) => u.email.toLowerCase() === profile.email);
  if (byEmail) {
    if (!byEmail.emailVerified) {
      return {
        status: 'email_conflict',
        message:
          'An account with this email already exists but its address is not verified yet. ' +
          'Sign in with your password first to verify it, then connect Google from Settings.',
      };
    }
    const now = new Date().toISOString();
    await store.mutate((d) => {
      const u = d.users.find((x) => x.id === byEmail.id);
      if (u) {
        u.googleId = profile.sub;
        if (profile.picture) u.avatarUrl = profile.picture;
        if (!u.displayName || u.displayName === u.email) u.displayName = profile.name ?? u.displayName;
        u.updatedAt = now;
      }
    });
    const updated = store.db().users.find((u) => u.id === byEmail.id)!;
    return { status: 'ok', user: updated, linked: true };
  }

  const now = new Date().toISOString();
  const userId = `user-${crypto.randomUUID()}`;
  const user: User = {
    id: userId,
    email: profile.email,
    displayName: profile.name ?? profile.email.split('@')[0] ?? 'Zenith user',
    passwordHash: '', // Google-only account — no password set yet
    passwordScheme: 'pbkdf2-sha256',
    salt: '',
    iterations: 0,
    googleId: profile.sub,
    avatarUrl: profile.picture,
    role: 'user',
    emailVerified: true, // Google verified it
    emailVerifiedAt: now,
    suspended: false,
    createdAt: now,
    updatedAt: now,
  };
  await store.mutate((d) => {
    d.users.push(user);
  });
  return { status: 'ok', user, linked: true };
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
