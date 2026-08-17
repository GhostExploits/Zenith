import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DbDocument, User } from '../types';
import type { Store } from './store';
import { emptyDb } from './schema';
import {
  handleWebhookEvent,
  isPaymentsConfigured,
  paymentsConfig,
  paymentsEnabled,
  requirePaymentsEnabled,
  verifyWebhookSignature,
  PaymentError,
  type PaddleWebhookEvent,
} from './payments';

/** In-memory Store mirroring the real Store contract. */
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

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'buyer@example.com',
    displayName: 'Buyer',
    passwordHash: '',
    passwordScheme: 'pbkdf2-sha256',
    salt: '',
    iterations: 1000,
    role: 'user',
    emailVerified: true,
    suspended: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('verifyWebhookSignature', () => {
  const secret = 'test-webhook-secret';
  const body = JSON.stringify({ event_type: 'transaction.completed', data: { id: 'txn_1' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const enc = new TextEncoder();

  async function sign(payload: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  beforeEach(() => {
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', secret);
    vi.stubEnv('PADDLE_API_KEY', 'test-api-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a valid signature over the raw body', async () => {
    const h1 = await sign(`${ts}:${body}`);
    const request = new Request('https://zenith.pages.dev/api/payments/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': `ts=${ts};h1=${h1}` },
      body,
    });
    expect(await verifyWebhookSignature(request, body)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const h1 = await sign(`${ts}:${body}`);
    const tampered = body.replace('txn_1', 'txn_2');
    const request = new Request('https://zenith.pages.dev/api/payments/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': `ts=${ts};h1=${h1}` },
      body: tampered,
    });
    expect(await verifyWebhookSignature(request, tampered)).toBe(false);
  });

  it('rejects a missing or malformed header', async () => {
    const request = new Request('https://zenith.pages.dev/api/payments/webhook', { method: 'POST', body });
    expect(await verifyWebhookSignature(request, body)).toBe(false);

    const bad = new Request('https://zenith.pages.dev/api/payments/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': 'nope' },
      body,
    });
    expect(await verifyWebhookSignature(bad, body)).toBe(false);
  });

  it('rejects a replayed (stale timestamp) signature', async () => {
    const h1 = await sign(`${ts}:${body}`);
    const oldTs = String(Math.floor(Date.now() / 1000) - 10 * 60); // 10 minutes ago
    const stale = await sign(`${oldTs}:${body}`);
    const request = new Request('https://zenith.pages.dev/api/payments/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': `ts=${oldTs};h1=${stale}` },
      body,
    });
    expect(await verifyWebhookSignature(request, body)).toBe(false);
    expect(h1).toBeTruthy();
  });
});

describe('payments maintenance mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled by default even when provider credentials are present', () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'paddle');
    vi.stubEnv('PADDLE_API_KEY', 'some-real-looking-key');
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', 'some-real-looking-secret');

    expect(paymentsEnabled()).toBe(false);
    expect(isPaymentsConfigured()).toBe(false);
    expect(paymentsConfig().configured).toBe(false);
  });

  it('requires PAYMENTS_ENABLED=true before any payment path can run', () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'paddle');
    vi.stubEnv('PADDLE_API_KEY', 'key');
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', 'secret');
    vi.stubEnv('PAYMENTS_ENABLED', 'false');

    expect(() => requirePaymentsEnabled()).toThrowError(
      expect.objectContaining({ code: 'payments_maintenance', status: 503 }),
    );
  });

  it('stays in maintenance even when creds are present but the flag is off', () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'paddle');
    vi.stubEnv('PADDLE_API_KEY', 'key');
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', 'secret');
    vi.stubEnv('PAYMENTS_ENABLED', 'true');

    // Deliberately enabled + credentials = live.
    expect(paymentsEnabled()).toBe(true);
    expect(isPaymentsConfigured()).toBe(true);
    expect(() => requirePaymentsEnabled()).not.toThrow();

    // Flag on but credentials missing = not configured (never silently live).
    vi.stubEnv('PADDLE_API_KEY', '');
    expect(isPaymentsConfigured()).toBe(false);
    try {
      requirePaymentsEnabled();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PaymentError);
      expect((err as PaymentError).code).toBe('payments_not_configured');
    }
  });
});

describe('handleWebhookEvent — idempotent grants', () => {
  let store: Store & { doc: DbDocument };

  beforeEach(() => {
    store = makeStore();
    store.doc.users.push(makeUser());
    store.doc.plans.push({
      id: 'zenith-gold',
      productId: 'zenith-v2',
      name: 'Gold',
      priceCents: 19999,
      currency: 'USD',
      interval: 'once',
      description: '',
      features: [],
      active: true,
      highlighted: false,
      licenseMode: 'permanent',
      tier: 'gold',
    });
  });

  function completedEvent(): PaddleWebhookEvent {
    return {
      event_id: 'evt-1',
      event_type: 'transaction.completed',
      data: {
        id: 'txn_01abc',
        custom_data: { user_id: 'user-1', plan_id: 'zenith-gold', product_id: 'zenith-v2', source: 'zenith' },
        currency_code: 'USD',
        details: { totals: { total: '19999' } },
      },
    };
  }

  it('creates a purchase + permanent license from a verified completion', async () => {
    await handleWebhookEvent(store, completedEvent());

    expect(store.doc.purchases).toHaveLength(1);
    expect(store.doc.purchases[0]!.status).toBe('paid');
    expect(store.doc.licenses).toHaveLength(1);
    expect(store.doc.licenses[0]!.kind).toBe('permanent');
    expect(store.doc.licenses[0]!.tier).toBe('GOLD');
    // The license is signed — the client-facing entitlement works.
    expect(store.doc.licenses[0]!.signature).toBeTruthy();
    expect(store.doc.purchases[0]!.licenseId).toBe(store.doc.licenses[0]!.id);
    // An owner notification was recorded.
    expect(store.doc.notifications.some((n) => n.type === 'purchase')).toBe(true);
  });

  it('does not double-grant when the same webhook is delivered twice', async () => {
    await handleWebhookEvent(store, completedEvent());
    await handleWebhookEvent(store, completedEvent());

    expect(store.doc.purchases).toHaveLength(1);
    expect(store.doc.licenses).toHaveLength(1);
  });

  it('creates a subscription license tied to the period end for recurring plans', async () => {
    store.doc.plans.push({
      id: 'zenith-bronze',
      productId: 'zenith-v2',
      name: 'Bronze',
      priceCents: 1499,
      currency: 'USD',
      interval: 'month',
      description: '',
      features: [],
      active: true,
      highlighted: false,
      licenseMode: 'subscription-period',
      tier: 'bronze',
    });
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await handleWebhookEvent(store, {
      event_id: 'evt-2',
      event_type: 'transaction.completed',
      data: {
        id: 'txn_02abc',
        subscription_id: 'sub_01abc',
        custom_data: { user_id: 'user-1', plan_id: 'zenith-bronze', product_id: 'zenith-v2', source: 'zenith' },
        currency_code: 'USD',
        billing_period: { ends_at: periodEnd },
        details: { totals: { total: '1499' } },
      },
    });

    expect(store.doc.subscriptions).toHaveLength(1);
    expect(store.doc.subscriptions[0]!.providerRef).toBe('sub_01abc');
    expect(store.doc.licenses).toHaveLength(1);
    expect(store.doc.licenses[0]!.kind).toBe('subscription');
    expect(store.doc.licenses[0]!.expiresAt).toBe(periodEnd);
    expect(store.doc.licenses[0]!.tier).toBe('BRONZE');
    expect(store.doc.licenses[0]!.signature).toBeTruthy();
  });

  it('does not mint a second license when a renewal webhook is re-delivered', async () => {
    store.doc.plans.push({
      id: 'zenith-bronze',
      productId: 'zenith-v2',
      name: 'Bronze',
      priceCents: 1499,
      currency: 'USD',
      interval: 'month',
      description: '',
      features: [],
      active: true,
      highlighted: false,
      licenseMode: 'subscription-period',
      tier: 'bronze',
    });
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const event = {
      event_id: 'evt-2',
      event_type: 'transaction.completed',
      data: {
        id: 'txn_02abc',
        subscription_id: 'sub_01abc',
        custom_data: { user_id: 'user-1', plan_id: 'zenith-bronze', product_id: 'zenith-v2', source: 'zenith' },
        currency_code: 'USD',
        billing_period: { ends_at: periodEnd },
        details: { totals: { total: '1499' } },
      },
    };
    await handleWebhookEvent(store, event);
    // Renewal: same subscription, new period end, webhook re-delivered twice.
    const later = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const renewal = { ...event, data: { ...event.data, billing_period: { ends_at: later } } };
    await handleWebhookEvent(store, renewal);
    await handleWebhookEvent(store, renewal);

    expect(store.doc.subscriptions).toHaveLength(1);
    expect(store.doc.licenses).toHaveLength(1);
    expect(store.doc.licenses[0]!.expiresAt).toBe(later);
  });

  it('revokes the license when the purchase is refunded', async () => {
    await handleWebhookEvent(store, completedEvent());
    const licenseId = store.doc.licenses[0]!.id;

    await handleWebhookEvent(store, {
      event_id: 'evt-3',
      event_type: 'transaction.refunded',
      data: { id: 'txn_01abc' },
    });

    expect(store.doc.purchases[0]!.status).toBe('refunded');
    expect(store.doc.licenses.find((l) => l.id === licenseId)!.status).toBe('revoked');
    expect(store.doc.notifications.some((n) => n.type === 'refund')).toBe(true);
  });
});
