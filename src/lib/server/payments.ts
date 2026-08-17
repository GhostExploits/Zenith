/**
 * Payments — Paddle (provider abstraction seam).
 *
 * Paddle is a Merchant of Record: it handles global payment methods, taxes and
 * compliance, so Zenith never touches a card number. Card details are collected
 * entirely on Paddle's hosted checkout; the only things that reach our server
 * are the checkout session we create and the signed webhooks Paddle sends.
 *
 * Security rules enforced here:
 *   - Card/CVV data never touches this codebase (Paddle Checkout only).
 *   - Every webhook is HMAC-SHA256 verified against the raw body with
 *     PADDLE_WEBHOOK_SECRET, with a timestamp replay window.
 *   - Entitlements/licenses are granted ONLY from verified webhook events,
 *     never from a browser claim.
 *   - Handlers are idempotent: re-delivered webhooks do not double-grant.
 *
 * The API is a thin provider-agnostic seam (`createCheckout`,
 * `cancelSubscription`, `verifyWebhook`, `handleWebhookEvent`) so a different
 * provider could be added later without touching routes or domain logic.
 */
import type { License, Plan, Product, Purchase, Subscription, User } from '../types';
import type { Store } from './store';
import { entitlementFields, signEntitlement } from './authority';
import { buildLicenseForPurchase } from './licenses';
import { notify } from './notifications';
import { logActivity } from './activity';
import { sendEmail } from './email';

const PADDLE_API = 'https://api.paddle.com';
const WEBHOOK_TOLERANCE_SECONDS = 300; // 5 minutes

const enc = new TextEncoder();

export class PaymentError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Maintenance mode.
 *
 * Payments are DISABLED by default and must be deliberately enabled with the
 * server-side `PAYMENTS_ENABLED=true` environment variable. Even if Paddle
 * credentials are present, no payment can be created, no provider API is
 * called, and no webhook is processed while this flag is off. This keeps the
 * store visible and browsable while the payment integration is being
 * finalized — nobody can be charged, and no card data is ever requested.
 */
export function paymentsEnabled(): boolean {
  return import.meta.env.PAYMENTS_ENABLED === 'true';
}

export interface PaymentsConfig {
  provider: string;
  enabled: boolean;
  configured: boolean;
  apiKey: string;
  webhookSecret: string;
}

export function paymentsConfig(): PaymentsConfig {
  const env = import.meta.env;
  const provider = env.PAYMENT_PROVIDER || 'paddle';
  const enabled = paymentsEnabled();
  const hasCredentials =
    provider === 'paddle' && Boolean(env.PADDLE_API_KEY) && Boolean(env.PADDLE_WEBHOOK_SECRET);
  return {
    provider,
    enabled,
    // "Configured" for the UI = deliberately enabled AND credentials present.
    // Credentials alone never turn payments on.
    configured: enabled && hasCredentials,
    apiKey: env.PADDLE_API_KEY ?? '',
    webhookSecret: env.PADDLE_WEBHOOK_SECRET ?? '',
  };
}

/** True only when the owner deliberately enabled payments AND configured a provider. */
export function isPaymentsConfigured(): boolean {
  return paymentsConfig().configured;
}

/**
 * Guard used by every payment-capable server path. Throws a 503 so the caller
 * can surface the maintenance message without ever touching the provider.
 */
export function requirePaymentsEnabled(): void {
  if (!paymentsEnabled()) {
    throw new PaymentError(
      503,
      'payments_maintenance',
      'Payments are temporarily unavailable while Zenith\u2019s payment system is being finalized. Please check back soon.',
    );
  }
  if (!isPaymentsConfigured()) {
    throw new PaymentError(503, 'payments_not_configured', 'Payments are not configured yet. Please try again later.');
  }
}

// ---------------------------------------------------------------------------
// Paddle API helpers
// ---------------------------------------------------------------------------

async function paddleRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const { apiKey } = paymentsConfig();
  if (!apiKey) {
    throw new PaymentError(503, 'payments_not_configured', 'Payments are not configured yet.');
  }
  let res: Response;
  try {
    res = await fetch(`${PADDLE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new PaymentError(502, 'provider_unreachable', 'The payment provider could not be reached.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[payments] Paddle API error', res.status, path, detail.slice(0, 500));
    throw new PaymentError(502, 'provider_error', `The payment provider returned an error (HTTP ${res.status}).`);
  }
  return res.json();
}

function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Resolve the Paddle customer id for a user (cached on the user row).
 * Paddle customers are matched by email; a new customer is created on first
 * checkout.
 */
async function getOrCreateCustomer(store: Store, user: User): Promise<string> {
  const existing = store.db().users.find((u) => u.id === user.id)?.providerCustomerId;
  if (existing) return existing;

  const listRes = (await paddleRequest(
    'GET',
    `/customers?email=${encodeURIComponent(user.email)}`,
  )) as { data?: { id: string }[] };
  const match = listRes.data?.find((c) => c.id);
  if (match) {
    await store.mutate((db) => {
      const u = db.users.find((x) => x.id === user.id);
      if (u) u.providerCustomerId = match.id;
    });
    return match.id;
  }

  const created = (await paddleRequest('POST', '/customers', {
    email: user.email,
    name: user.displayName,
  })) as { data?: { id: string } };
  if (!created.data?.id) throw new PaymentError(502, 'provider_error', 'Could not create the payment customer.');
  await store.mutate((db) => {
    const u = db.users.find((x) => x.id === user.id);
    if (u) u.providerCustomerId = created.data!.id;
  });
  return created.data.id;
}

export interface CheckoutInput {
  store: Store;
  user: User;
  plan: Plan;
  product: Product;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckout(input: CheckoutInput): Promise<{ url: string; transactionId: string }> {
  const { store, user, plan, product, successUrl, cancelUrl } = input;
  const cfg = paymentsConfig();
  if (!cfg.configured) {
    throw new PaymentError(503, 'payments_not_configured', 'Payments are not configured yet.');
  }
  if (plan.priceCents === null || plan.priceCents <= 0) {
    throw new PaymentError(400, 'invalid_price', 'This plan has no price configured.');
  }

  const customerId = await getOrCreateCustomer(store, user);

  const price: Record<string, unknown> = {
    description: `${product.name} — ${plan.name}`,
    unit_price: { amount: String(plan.priceCents), currency_code: plan.currency },
    tax_mode: 'account_setting',
  };
  if (plan.interval !== 'once') {
    price.billing_cycle = { interval: plan.interval === 'month' ? 'month' : 'year', frequency: 1 };
  }

  const txn = (await paddleRequest('POST', '/transactions', {
    items: [{ quantity: 1, price }],
    currency_code: plan.currency,
    customer_id: customerId,
    collection_mode: 'automatic',
    custom_data: {
      user_id: user.id,
      plan_id: plan.id,
      product_id: plan.productId,
      source: 'zenith',
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })) as { data?: { id: string; checkout?: { url?: string } } };

  const url = txn.data?.checkout?.url;
  const txnId = txn.data?.id;
  if (!url || !txnId) {
    throw new PaymentError(502, 'provider_error', 'The payment provider did not return a checkout.');
  }
  return { url, transactionId: txnId };
}

// ---------------------------------------------------------------------------
// Subscription lifecycle (account portal → provider)
// ---------------------------------------------------------------------------

export async function cancelSubscription(providerRef: string): Promise<void> {
  // Never touch the provider while payments are disabled.
  requirePaymentsEnabled();
  await paddleRequest('POST', `/subscriptions/${encodeURIComponent(providerRef)}/cancel`, {
    effective_from: 'next_billing_period',
  });
}

export async function reinstateSubscription(providerRef: string): Promise<void> {
  requirePaymentsEnabled();
  await paddleRequest('POST', `/subscriptions/${encodeURIComponent(providerRef)}/revoke-cancellation`);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify the `Paddle-Signature: ts=…;h1=…` header against the RAW body.
 * The signature is HMAC-SHA256 of `${timestamp}:${body}` keyed with the
 * notification secret, with a replay window.
 */
export async function verifyWebhookSignature(request: Request, rawBody: string): Promise<boolean> {
  const { webhookSecret } = paymentsConfig();
  if (!webhookSecret) return false;
  const header = request.headers.get('paddle-signature');
  if (!header) return false;

  const parts: Record<string, string> = {};
  for (const chunk of header.split(';')) {
    const idx = chunk.indexOf('=');
    if (idx === -1) continue;
    parts[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim();
  }
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  // Replay protection: reject signatures older than the tolerance window.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const key = await crypto.subtle.importKey('raw', enc.encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${rawBody}`));
  const expected = toHex(sig);
  // Paddle may include several signatures (secret rotation) comma-separated.
  return h1.split(',').some((s) => constantTimeEqual(s.trim(), expected));
}

export interface PaddleWebhookEvent {
  event_id: string;
  event_type: string;
  occurred_at?: string;
  data: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Event handlers (idempotent, server-authoritative)
// ---------------------------------------------------------------------------

/**
 * A paid/completed transaction. Creates the purchase, the subscription (for
 * recurring plans), and the license — all idempotent so a re-delivered
 * webhook is a no-op. The license entitlement is SIGNED (Ed25519) before the
 * write; the signature is part of the record the Zenith client verifies.
 */
async function handleTransaction(store: Store, data: Record<string, any>): Promise<void> {
  const txnId = String(data.id ?? '');
  if (!txnId) return;
  const custom = (data.custom_data ?? {}) as Record<string, unknown>;
  const planId = String(custom.plan_id ?? '');
  const userId = String(custom.user_id ?? '');
  const subRef = data.subscription_id ? String(data.subscription_id) : undefined;
  const now = new Date().toISOString();

  const db = store.db();
  const plan = db.plans.find((p) => p.id === planId);
  const user = db.users.find((u) => u.id === userId);
  if (!plan || !user) {
    await notify(
      store,
      'payment',
      'Unrecognized payment',
      `Transaction ${txnId} referenced plan ${planId || '(none)'} / user ${userId || '(none)'} which do not exist here.`,
    );
    return;
  }

  const amountCents = Math.round(Number(data.details?.totals?.total ?? 0));
  const currency = String(data.currency_code ?? plan.currency);
  const periodEnd = data.billing_period?.ends_at ? String(data.billing_period.ends_at) : undefined;

  // Existing records (idempotency base) — license links to the INTERNAL
  // subscription id, not the provider reference.
  const existingPurchase = db.purchases.find((p) => p.providerRef === txnId);
  const existingSub = subRef ? db.subscriptions.find((s) => s.providerRef === subRef) : undefined;
  const existingLicense = existingSub
    ? db.licenses.find((l) => l.subscriptionId === existingSub.id)
    : existingPurchase?.licenseId
      ? db.licenses.find((l) => l.id === existingPurchase.licenseId)
      : undefined;

  // Build + sign the license BEFORE the write (signing is async and
  // store.mutate callbacks are synchronous).
  let licenseToGrant: License | undefined;
  if (!existingLicense) {
    const purchase: Purchase = {
      id: existingPurchase?.id ?? `purchase-${crypto.randomUUID()}`,
      userId: user.id,
      productId: plan.productId,
      planId: plan.id,
      amountCents: amountCents || (plan.priceCents ?? 0),
      currency,
      status: 'paid',
      provider: 'paddle',
      providerRef: txnId,
      createdAt: now,
      paidAt: now,
    };
    const subscription: Subscription | undefined = subRef
      ? {
          id: existingSub?.id ?? `sub-${crypto.randomUUID()}`,
          userId: user.id,
          productId: plan.productId,
          planId: plan.id,
          status: 'active',
          currentPeriodEnd:
            periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          cancelAtPeriodEnd: false,
          provider: 'paddle',
          providerRef: subRef,
          createdAt: now,
        }
      : undefined;
    licenseToGrant = await buildLicenseForPurchase(db, user, plan, purchase, subscription);
  }

  // A renewal extends the license's expiry — expiry is part of the signed
  // payload, so the signature must be re-computed for the new period.
  let renewalSignature: string | undefined;
  if (existingLicense && periodEnd && existingLicense.expiresAt !== periodEnd) {
    renewalSignature = await signEntitlement(
      entitlementFields({ ...existingLicense, expiresAt: periodEnd } as License),
    );
  }

  let licenseKey = existingLicense?.key ?? '';

  await store.mutate((d) => {
    // Purchase — idempotent by provider reference.
    let purchase = d.purchases.find((p) => p.providerRef === txnId);
    if (!purchase) {
      purchase = {
        id: licenseToGrant?.purchaseId ?? `purchase-${crypto.randomUUID()}`,
        userId: user.id,
        productId: plan.productId,
        planId: plan.id,
        amountCents: amountCents || (plan.priceCents ?? 0),
        currency,
        status: 'paid',
        provider: 'paddle',
        providerRef: txnId,
        createdAt: now,
        paidAt: now,
      };
      d.purchases.push(purchase);
    } else {
      purchase.status = 'paid';
      purchase.paidAt = now;
      if (amountCents) purchase.amountCents = amountCents;
    }

    // Subscription (recurring plans only).
    let subscription: Subscription | undefined;
    if (subRef) {
      subscription = d.subscriptions.find((s) => s.providerRef === subRef);
      if (!subscription) {
        subscription = {
          id: licenseToGrant?.subscriptionId ?? `sub-${crypto.randomUUID()}`,
          userId: user.id,
          productId: plan.productId,
          planId: plan.id,
          status: 'active',
          currentPeriodEnd:
            periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          cancelAtPeriodEnd: false,
          provider: 'paddle',
          providerRef: subRef,
          createdAt: now,
        };
        d.subscriptions.push(subscription);
      } else {
        subscription.status = 'active';
        if (periodEnd) subscription.currentPeriodEnd = periodEnd;
      }
    }

    // License — one per subscription (extended on renewal) or per permanent
    // purchase. Found by internal id (or the purchase link for one-time buys).
    let license = licenseToGrant
      ? d.licenses.find((l) => l.id === licenseToGrant!.id)
      : existingLicense
        ? d.licenses.find((l) => l.id === existingLicense!.id)
        : undefined;
    if (!license) {
      license =
        d.licenses.find((l) => l.purchaseId === purchase!.id) ??
        (subRef ? d.licenses.find((l) => l.subscriptionId === subRef) : undefined);
    }
    if (!license && licenseToGrant) {
      d.licenses.push(licenseToGrant);
      license = licenseToGrant;
    }
    if (license) {
      license.status = 'active';
      license.activatedAt = license.activatedAt ?? now;
      if (subscription?.currentPeriodEnd) {
        license.expiresAt = subscription.currentPeriodEnd;
        if (renewalSignature) license.signature = renewalSignature;
      }
      purchase!.licenseId = license.id;
      licenseKey = license.key;
    }
  });

  const amountText = `${currency} ${(amountCents / 100).toFixed(2)}`;
  await notify(
    store,
    'purchase',
    'Payment received',
    `${user.email} — ${plan.name} (${amountText}). License ${licenseKey} granted.`,
  );
  await logActivity(
    store,
    user.id,
    'purchase',
    `Paid for ${plan.name} — license key ${licenseKey}.`,
  );

  // Deliver the license key by email (best effort — never blocks the flow).
  if (user.emailVerified) {
    const base = import.meta.env.PUBLIC_SITE_URL ?? 'https://zenith.pages.dev';
    await sendEmail({
      to: user.email,
      subject: 'Your Zenith license key',
      text: `Thanks for buying ${plan.name}!\n\nYour license key:\n${licenseKey}\n\nSign in to manage it at ${base}/account.\n\n— The Zenith team`,
    }).catch(() => undefined);
  }
}

async function handleRefund(store: Store, data: Record<string, any>): Promise<void> {
  const txnId = String(data.id ?? '');
  const db = store.db();
  const purchase = db.purchases.find((p) => p.providerRef === txnId);
  if (!purchase) {
    await notify(store, 'refund', 'Refund for unknown transaction', `Transaction ${txnId} has no matching purchase here.`);
    return;
  }
  const user = db.users.find((u) => u.id === purchase.userId);
  await store.mutate((d) => {
    const p = d.purchases.find((x) => x.id === purchase.id);
    if (p) {
      p.status = 'refunded';
      p.refundedAt = new Date().toISOString();
    }
    if (p?.licenseId) {
      const lic = d.licenses.find((l) => l.id === p.licenseId);
      if (lic && lic.status !== 'revoked') {
        lic.status = 'revoked';
        lic.revokedAt = new Date().toISOString();
      }
    }
  });
  await notify(
    store,
    'refund',
    'Refund processed',
    `${user?.email ?? purchase.userId} — ${purchase.planId} (${txnId}). License revoked.`,
  );
}

/** Apply a provider-confirmed subscription state change. */
async function handleSubscriptionState(
  store: Store,
  data: Record<string, any>,
  status: Subscription['status'],
  opts?: { cancelAtPeriodEnd?: boolean },
): Promise<void> {
  const subRef = String(data.id ?? '');
  const db = store.db();
  const sub = db.subscriptions.find((s) => s.providerRef === subRef);
  if (!sub) {
    await notify(store, 'subscription', 'Subscription event for unknown plan', `Subscription ${subRef} is not tracked here.`);
    return;
  }
  const user = db.users.find((u) => u.id === sub.userId);
  // If the period end moves, the license expiry changes — re-sign the payload
  // (expiry is part of the signed entitlement).
  const nextPeriodEnd = data.next_billed_at && status === 'active' ? String(data.next_billed_at) : undefined;
  const linkedLicense = db.licenses.find((l) => l.subscriptionId === sub.id);
  let reSigned: string | undefined;
  if (nextPeriodEnd && linkedLicense && linkedLicense.expiresAt !== nextPeriodEnd) {
    reSigned = await signEntitlement(entitlementFields({ ...linkedLicense, expiresAt: nextPeriodEnd } as License));
  }
  await store.mutate((d) => {
    const s = d.subscriptions.find((x) => x.providerRef === subRef);
    if (!s) return;
    s.status = status;
    if (opts?.cancelAtPeriodEnd !== undefined) s.cancelAtPeriodEnd = opts.cancelAtPeriodEnd;
    if (nextPeriodEnd) s.currentPeriodEnd = nextPeriodEnd;
    // License is linked by the INTERNAL subscription id (not the provider ref).
    const lic = d.licenses.find((l) => l.subscriptionId === s.id);
    if (lic && status === 'active') {
      lic.status = 'active';
      if (nextPeriodEnd) lic.expiresAt = nextPeriodEnd;
      if (reSigned) lic.signature = reSigned;
    }
  });
  await notify(
    store,
    'subscription',
    `Subscription ${status === 'canceled' ? 'cancelled' : status.replace('_', ' ')}`,
    `${user?.email ?? sub.userId} — ${sub.planId}.`,
  );
}

export async function handleWebhookEvent(store: Store, event: PaddleWebhookEvent): Promise<void> {
  const { event_type: type, data } = event;

  switch (type) {
    case 'transaction.completed':
    case 'transaction.paid':
      await handleTransaction(store, data);
      return;
    case 'transaction.refunded':
    case 'transaction.fully_refunded':
      await handleRefund(store, data);
      return;
    case 'transaction.past_due':
    case 'payment_failed': {
      const txnId = String(data.id ?? data.transaction_id ?? '');
      await store.mutate((d) => {
        const p = d.purchases.find((x) => x.providerRef === txnId);
        if (p && p.status === 'pending') p.status = 'failed';
      });
      await notify(store, 'payment', 'Payment failed', `Transaction ${txnId} could not be collected.`);
      return;
    }
    case 'subscription.canceled':
      await handleSubscriptionState(store, data, 'canceled', { cancelAtPeriodEnd: true });
      return;
    case 'subscription.past_due':
    case 'subscription.paused':
      await handleSubscriptionState(store, data, 'past_due');
      return;
    case 'subscription.resumed':
    case 'subscription.activated':
      await handleSubscriptionState(store, data, 'active', { cancelAtPeriodEnd: false });
      return;
    case 'subscription.updated': {
      const cancelScheduled = data.scheduled_change?.action === 'cancel';
      await handleSubscriptionState(store, data, 'active', { cancelAtPeriodEnd: cancelScheduled });
      return;
    }
    case 'subscription.created':
    case 'subscription.credited':
      // Informational; the real grant happens on transaction.completed.
      return;
    default:
      await notify(
        store,
        'system',
        'Unhandled payment webhook',
        `${type} (${event.event_id}). No action taken — add handling if this event matters.`,
      );
  }
}
