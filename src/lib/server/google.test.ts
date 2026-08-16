import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encodeJWT } from '@oslojs/jwt';
import { handleGoogleCallback } from './google';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const REDIRECT = 'http://127.0.0.1:4321/api/auth/google/callback';

function makeIdToken(payload: Record<string, unknown>): string {
  // arctic's decodeIdToken only parses the JWT — the signature is not
  // verified, so a dummy signature is enough to exercise claim validation.
  return encodeJWT(JSON.stringify({ alg: 'RS256', typ: 'JWT' }), JSON.stringify(payload), new Uint8Array([1, 2, 3]));
}

function makeOAuthRequest(stateCookie: string | null, code = 'code-123', stateParam = 'state-123'): Request {
  const headers: Record<string, string> = {};
  if (stateCookie) headers['cookie'] = `zenith_oauth=${encodeURIComponent(stateCookie)}`;
  return new Request(`${REDIRECT}?code=${code}&state=${stateParam}`, { headers });
}

const validClaims = (nonce: string) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-user-1',
  email: 'person@gmail.com',
  email_verified: true,
  name: 'Person',
  picture: 'https://lh3.googleusercontent.com/pic',
  nonce,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  azp: CLIENT_ID,
});

describe('handleGoogleCallback', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
    vi.stubEnv('GOOGLE_REDIRECT_URI', REDIRECT);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function mockTokenEndpoint(idToken: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        // arctic passes a Request object as the single argument.
        const req = input instanceof Request ? input : new Request(input, init);
        expect(String(req.url)).toBe('https://oauth2.googleapis.com/token');
        expect(req.method).toBe('POST');
        return new Response(
          JSON.stringify({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600, id_token: idToken }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
  }

  it('exchanges the code and returns the verified profile', async () => {
    const nonce = 'nonce-abc';
    const stateCookie = JSON.stringify({ state: 'state-123', codeVerifier: 'verifier-1', nonce, next: '/account/settings' });
    mockTokenEndpoint(makeIdToken(validClaims(nonce)));

    const result = await handleGoogleCallback(makeOAuthRequest(stateCookie));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.email).toBe('person@gmail.com');
      expect(result.profile.emailVerified).toBe(true);
      expect(result.profile.sub).toBe('google-user-1');
      expect(result.next).toBe('/account/settings');
      expect(result.clearCookie).toContain('zenith_oauth=');
    }
  });

  it('rejects a mismatched state without calling Google', async () => {
    const stateCookie = JSON.stringify({ state: 'state-other', codeVerifier: 'verifier-1', nonce: 'nonce-abc' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleGoogleCallback(makeOAuthRequest(stateCookie, 'code-123', 'state-123'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('oauth_invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when there is no state cookie', async () => {
    const result = await handleGoogleCallback(makeOAuthRequest(null));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('oauth_invalid_state');
  });

  it('rejects an ID token with the wrong nonce (replay protection)', async () => {
    const stateCookie = JSON.stringify({ state: 'state-123', codeVerifier: 'verifier-1', nonce: 'nonce-abc' });
    mockTokenEndpoint(makeIdToken(validClaims('nonce-other')));

    const result = await handleGoogleCallback(makeOAuthRequest(stateCookie));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('oauth_failed');
  });

  it('rejects an ID token issued for a different audience', async () => {
    const stateCookie = JSON.stringify({ state: 'state-123', codeVerifier: 'verifier-1', nonce: 'nonce-abc' });
    const claims = validClaims('nonce-abc');
    claims.aud = 'evil-client.apps.googleusercontent.com';
    mockTokenEndpoint(makeIdToken(claims));

    const result = await handleGoogleCallback(makeOAuthRequest(stateCookie));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('oauth_failed');
  });

  it('rejects an ID token from a non-Google issuer', async () => {
    const stateCookie = JSON.stringify({ state: 'state-123', codeVerifier: 'verifier-1', nonce: 'nonce-abc' });
    const claims = validClaims('nonce-abc');
    claims.iss = 'https://evil.example.com';
    mockTokenEndpoint(makeIdToken(claims));

    const result = await handleGoogleCallback(makeOAuthRequest(stateCookie));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('oauth_failed');
  });
});
