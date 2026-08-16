/**
 * Single-use, expiring tokens for email verification and password reset.
 *
 * All token validation funnels through `consumeToken` so the rules are
 * enforced in exactly one place: a token can be used once, expires after its
 * window, and is marked used at consumption (a race can never double-spend
 * because the mutation is serialized by the store).
 */
import type { Store } from './store';

export type TokenKind = 'verify-email' | 'reset-password';

export interface ConsumeResult {
  status: 'ok' | 'used' | 'expired' | 'invalid';
  userId?: string;
  /** For verify-email tokens issued by an email change: the address to adopt. */
  email?: string;
}

export function generateToken(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate and consume a token. Marks it used when valid.
 */
export async function consumeToken(store: Store, kind: TokenKind, token: string): Promise<ConsumeResult> {
  const db = store.db();
  const record = db.tokens.find((t) => t.kind === kind && t.token === token);
  if (!record) return { status: 'invalid' };
  if (record.usedAt) return { status: 'used' };
  if (new Date(record.expiresAt).getTime() < Date.now()) return { status: 'expired' };
  await store.mutate((d) => {
    const t = d.tokens.find((x) => x.id === record.id);
    if (t) t.usedAt = new Date().toISOString();
  });
  return { status: 'ok', userId: record.userId, email: record.email };
}

/** Issue a new token, invalidating any previous tokens of the same kind for the user. */
export async function issueToken(
  store: Store,
  kind: TokenKind,
  userId: string,
  ttlMs: number,
  email?: string,
): Promise<string> {
  const token = generateToken();
  const now = new Date().toISOString();
  await store.mutate((d) => {
    d.tokens = d.tokens.filter((t) => t.kind !== kind || t.userId !== userId);
    d.tokens.push({
      id: `tok-${crypto.randomUUID()}`,
      userId,
      kind,
      token,
      email,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      createdAt: now,
    });
  });
  return token;
}
