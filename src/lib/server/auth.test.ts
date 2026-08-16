import { describe, it, expect, beforeEach } from 'vitest';
import type { DbDocument } from '../types';
import type { Store } from './store';
import { emptyDb } from './schema';
import { consumeToken, issueToken } from './tokens';
import { linkGoogleIdentity, type GoogleProfile } from './google';

/** In-memory Store for tests (mirrors the real Store contract). */
function makeStore(): Store & { doc: DbDocument } {
  const doc = emptyDb();
  const store: Store & { doc: DbDocument } = {
    doc,
    db: () => store.doc,
    mutate: async (fn) => {
      fn(store.doc);
    },
  };
  return store;
}

function makeUser(overrides: Partial<DbDocument['users'][number]> = {}): DbDocument['users'][number] {
  return {
    id: 'user-test',
    email: 'test@example.com',
    displayName: 'Test',
    passwordHash: 'x'.repeat(64),
    passwordScheme: 'pbkdf2-sha256',
    salt: 'abc',
    iterations: 1000,
    role: 'user',
    emailVerified: true,
    suspended: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const googleProfile: GoogleProfile = {
  sub: 'google-sub-123',
  email: 'test@example.com',
  emailVerified: true,
  name: 'Test Person',
  picture: 'https://example.com/pic.png',
};

describe('consumeToken — single-use + expiry', () => {
  let store: Store & { doc: DbDocument };

  beforeEach(() => {
    store = makeStore();
  });

  it('consumes a valid token and marks it used', async () => {
    const token = await issueToken(store, 'verify-email', 'user-1', 60_000);
    const first = await consumeToken(store, 'verify-email', token);
    expect(first.status).toBe('ok');
    expect(first.userId).toBe('user-1');

    const second = await consumeToken(store, 'verify-email', token);
    expect(second.status).toBe('used');
  });

  it('rejects an unknown token', async () => {
    const result = await consumeToken(store, 'reset-password', 'nope');
    expect(result.status).toBe('invalid');
  });

  it('rejects an expired token', async () => {
    const token = await issueToken(store, 'reset-password', 'user-1', 1);
    // Force expiry.
    store.doc.tokens[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const result = await consumeToken(store, 'reset-password', token);
    expect(result.status).toBe('expired');
  });

  it('only consumes tokens of the matching kind', async () => {
    const token = await issueToken(store, 'verify-email', 'user-1', 60_000);
    const result = await consumeToken(store, 'reset-password', token);
    expect(result.status).toBe('invalid');
  });

  it('issuing a new token invalidates previous ones of the same kind', async () => {
    const oldToken = await issueToken(store, 'verify-email', 'user-1', 60_000);
    const newToken = await issueToken(store, 'verify-email', 'user-1', 60_000);
    expect(oldToken).not.toBe(newToken);
    const oldResult = await consumeToken(store, 'verify-email', oldToken);
    expect(oldResult.status).toBe('invalid');
    const newResult = await consumeToken(store, 'verify-email', newToken);
    expect(newResult.status).toBe('ok');
  });
});

describe('linkGoogleIdentity — account linking rules', () => {
  let store: Store & { doc: DbDocument };

  beforeEach(() => {
    store = makeStore();
  });

  it('signs in to an existing account that already has the Google id', async () => {
    store.doc.users.push(makeUser({ id: 'user-1', googleId: 'google-sub-123' }));
    const result = await linkGoogleIdentity(store, googleProfile);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.user.id).toBe('user-1');
      expect(result.linked).toBe(false);
      // googleId unchanged, no duplicate created
      expect(store.doc.users).toHaveLength(1);
    }
  });

  it('links a verified email account to Google without duplicating it', async () => {
    store.doc.users.push(makeUser({ id: 'user-1', email: 'test@example.com', emailVerified: true }));
    const result = await linkGoogleIdentity(store, googleProfile);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.user.id).toBe('user-1');
      expect(result.linked).toBe(true);
      expect(result.user.googleId).toBe('google-sub-123');
    }
    expect(store.doc.users).toHaveLength(1);
  });

  it('refuses to link when the matching email is unverified', async () => {
    store.doc.users.push(makeUser({ id: 'user-1', email: 'test@example.com', emailVerified: false }));
    const result = await linkGoogleIdentity(store, googleProfile);
    expect(result.status).toBe('email_conflict');
    // Nothing was mutated — no linking, no duplicate.
    expect(store.doc.users[0]!.googleId).toBeUndefined();
    expect(store.doc.users).toHaveLength(1);
  });

  it('creates a new verified account when there is no match', async () => {
    const result = await linkGoogleIdentity(store, googleProfile);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.emailVerified).toBe(true);
      expect(result.user.passwordHash).toBe(''); // Google-only — no password
      expect(result.user.googleId).toBe('google-sub-123');
      expect(result.linked).toBe(true);
    }
    expect(store.doc.users).toHaveLength(1);
  });

  it('normalizes the email case so duplicates are impossible', async () => {
    store.doc.users.push(makeUser({ id: 'user-1', email: 'TEST@Example.com', emailVerified: true }));
    const result = await linkGoogleIdentity(store, { ...googleProfile, email: 'test@example.com' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.user.id).toBe('user-1');
    }
    expect(store.doc.users).toHaveLength(1);
  });
});
