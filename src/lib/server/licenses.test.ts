import { describe, it, expect, beforeEach } from 'vitest';
import type { DbDocument, Plan, Purchase, Subscription, User } from '../types';
import type { Store } from './store';
import { emptyDb } from './schema';
import {
  authorityStatus,
  buildLicenseForPurchase,
  buildManualLicense,
  checkLicense,
  extendLicense,
  findLicenseByKey,
  generateLicenseKey,
  generateUniqueLicenseKey,
  licenseEffectiveStatus,
  LICENSE_CODES,
  reactivateLicense,
  resetLicenseDevice,
  revokeLicense,
  setLicenseTier,
  suspendLicense,
} from './licenses';
import { verifyLicenseSignature } from './authority';

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

function makeUser(): User {
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
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
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
    ...overrides,
  };
}

function makePurchase(user: User): Purchase {
  return {
    id: 'purchase-1',
    userId: user.id,
    productId: 'zenith-v2',
    planId: 'zenith-gold',
    amountCents: 19999,
    currency: 'USD',
    status: 'paid',
    provider: 'paddle',
    providerRef: 'txn_test',
    createdAt: new Date().toISOString(),
  };
}

function makeSubscription(user: User, plan: Plan, daysAhead = 30): Subscription {
  return {
    id: 'sub-1',
    userId: user.id,
    productId: plan.productId,
    planId: plan.id,
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    provider: 'paddle',
    providerRef: 'sub_ref',
    createdAt: new Date().toISOString(),
  };
}

describe('license keys', () => {
  it('generates ZEN-XXXX-XXXX-XXXX keys from the safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const key = generateLicenseKey();
      expect(key).toMatch(/^ZEN-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      // No ambiguous characters in the generated groups (I, O, 0, 1 excluded)
      const body = key.slice('ZEN-'.length);
      expect(body).not.toMatch(/[IO01]/);
    }
  });

  it('generates unique keys within a document', () => {
    const db = emptyDb();
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const key = generateUniqueLicenseKey(db);
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });
});

describe('signed license issuance', () => {
  it('grants a signed permanent license for permanent plans', async () => {
    const store = makeStore();
    const user = makeUser();
    const plan = makePlan({ licenseMode: 'permanent', tier: 'gold' });
    const purchase = makePurchase(user);
    const license = await buildLicenseForPurchase(store.doc, user, plan, purchase);

    expect(license.kind).toBe('permanent');
    expect(license.status).toBe('active');
    expect(license.expiresAt).toBeUndefined();
    expect(license.purchaseId).toBe(purchase.id);
    expect(license.key).toMatch(/^ZEN-/);
    expect(license.tier).toBe('GOLD');
    expect(license.recipient).toBe(user.email);
    // The license carries an Ed25519 signature over the canonical payload.
    expect(license.signature).toBeTruthy();
    const verified = await verifyLicenseSignature(license);
    expect(verified.ok).toBe(true);
  });

  it('ties subscription licenses to the subscription period end', async () => {
    const store = makeStore();
    const user = makeUser();
    const plan = makePlan({ id: 'zenith-bronze', licenseMode: 'subscription-period', tier: 'bronze' });
    const purchase = makePurchase(user);
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const subscription = makeSubscription(user, plan, 30);
    subscription.currentPeriodEnd = periodEnd;
    const license = await buildLicenseForPurchase(store.doc, user, plan, purchase, subscription);

    expect(license.kind).toBe('subscription');
    expect(license.expiresAt).toBe(periodEnd);
    expect(license.subscriptionId).toBe('sub-1');
    expect(license.tier).toBe('BRONZE');
    const verified = await verifyLicenseSignature(license);
    expect(verified.ok).toBe(true);
  });

  it('admin-issued licenses start unused and signed', async () => {
    const store = makeStore();
    const license = await buildManualLicense(store.doc, makeUser(), makePlan());
    expect(license.status).toBe('unused');
    expect(license.activationHistory).toEqual([]);
    expect(license.signature).toBeTruthy();
  });
});

describe('authority checks (device binding)', () => {
  let store: Store & { doc: DbDocument };
  let license: Awaited<ReturnType<typeof buildLicenseForPurchase>>;

  beforeEach(async () => {
    store = makeStore();
    const user = makeUser();
    const plan = makePlan({ licenseMode: 'subscription-period', tier: 'silver' });
    const purchase = makePurchase(user);
    const subscription = makeSubscription(user, plan);
    license = await buildLicenseForPurchase(store.doc, user, plan, purchase, subscription);
    store.doc.licenses.push(license);
  });

  it('binds the license to the first device and reports ACTIVE', async () => {
    const result = await checkLicense(store, license.key, 'device-aaaa', { bind: true, clientVersion: 'Zenith V2 (4.21)' });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('ACTIVE');
    expect(result.payload).toBeTruthy();
    expect(result.signature).toBeTruthy();
    expect(store.doc.licenses[0]!.deviceId).toBe('device-aaaa');
    expect(store.doc.licenses[0]!.clientVersion).toBe('Zenith V2 (4.21)');
    // The device binding is recorded in the response.
    expect(result.license?.deviceId).toBe('device-aaaa');
  });

  it('rejects a second device with LICENSE_BOUND_OTHER', async () => {
    await checkLicense(store, license.key, 'device-aaaa', { bind: true });
    const other = await checkLicense(store, license.key, 'device-bbbb', { bind: true });
    expect(other.ok).toBe(false);
    expect(other.code).toBe(LICENSE_CODES.BOUND_OTHER);
  });

  it('status check (client path) rejects when bound to another device', async () => {
    await checkLicense(store, license.key, 'device-aaaa', { bind: true });
    const status = await checkLicense(store, license.key, 'device-bbbb', {});
    expect(status.ok).toBe(false);
    expect(status.code).toBe(LICENSE_CODES.BOUND_OTHER);
  });

  it('status check succeeds for the bound device without re-binding', async () => {
    await checkLicense(store, license.key, 'device-aaaa', { bind: true });
    const before = store.doc.licenses[0]!.boundAt;
    const status = await checkLicense(store, license.key, 'device-aaaa', {});
    expect(status.ok).toBe(true);
    expect(status.signature).toBeTruthy();
    expect(store.doc.licenses[0]!.boundAt).toBe(before);
  });

  it('rejects an unknown key with LICENSE_INVALID', async () => {
    const result = await checkLicense(store, 'ZEN-AAAA-BBBB-CCCC', 'device-aaaa', { bind: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LICENSE_CODES.INVALID);
  });

  it('rejects revoked and expired licenses', async () => {
    await checkLicense(store, license.key, 'device-aaaa', { bind: true });
    revokeLicense(store.doc, license.id, 'abuse');
    let result = await checkLicense(store, license.key, 'device-aaaa', {});
    expect(result.code).toBe(LICENSE_CODES.REVOKED);

    // A properly-signed subscription license whose period has ended is EXPIRED
    // (expiry is part of the signed payload, so it cannot be edited by hand).
    reactivateLicense(store.doc, license.id);
    const user = makeUser();
    const expiredPlan = makePlan({ id: 'zenith-bronze', licenseMode: 'subscription-period', tier: 'bronze' });
    const purchase = makePurchase(user);
    const expired = await buildLicenseForPurchase(
      store.doc,
      user,
      expiredPlan,
      purchase,
      makeSubscription(user, expiredPlan, -1),
    );
    store.doc.licenses.push(expired);
    result = await checkLicense(store, expired.key, 'device-aaaa', {});
    expect(result.code).toBe(LICENSE_CODES.EXPIRED);

    suspendLicense(store.doc, license.id);
    result = await checkLicense(store, license.key, 'device-aaaa', {});
    expect(result.code).toBe(LICENSE_CODES.INACTIVE);
  });
});

describe('license lifecycle', () => {
  it('computes expiry dynamically and maps to client statuses', async () => {
    const store = makeStore();
    const user = makeUser();
    const plan = makePlan({ licenseMode: 'subscription-period', tier: 'diamond' });
    const purchase = makePurchase(user);
    const license = await buildLicenseForPurchase(
      store.doc,
      user,
      plan,
      purchase,
      makeSubscription(user, plan, -1), // already past
    );
    store.doc.licenses.push(license);
    expect(licenseEffectiveStatus(license)).toBe('expired');
    expect(authorityStatus(license)).toBe('EXPIRED');
    expect(authorityStatus({ ...license, status: 'revoked' })).toBe('REVOKED');
    expect(authorityStatus({ ...license, status: 'unused', expiresAt: undefined })).toBe('INACTIVE');
    expect(authorityStatus({ ...license, status: 'active', expiresAt: undefined })).toBe('ACTIVE');
  });

  it('revokes, reactivates, and finds licenses', async () => {
    const store = makeStore();
    const user = makeUser();
    const plan = makePlan();
    const purchase = makePurchase(user);
    const license = await buildLicenseForPurchase(store.doc, user, plan, purchase);
    store.doc.licenses.push(license);

    revokeLicense(store.doc, license.id, 'Policy violation');
    expect(licenseEffectiveStatus(license)).toBe('revoked');

    reactivateLicense(store.doc, license.id);
    expect(licenseEffectiveStatus(license)).toBe('active');

    expect(findLicenseByKey(store.doc, license.key.toLowerCase())?.id).toBe(license.id);
  });

  it('extend re-signs the entitlement for the new expiry', async () => {
    const store = makeStore();
    const user = makeUser();
    const plan = makePlan();
    const purchase = makePurchase(user);
    const license = await buildLicenseForPurchase(store.doc, user, plan, purchase);
    store.doc.licenses.push(license);
    const originalSignature = license.signature;

    await extendLicense(store, license.id, 30);
    const updated = store.doc.licenses.find((l) => l.id === license.id)!;
    expect(updated.expiresAt).toBeTruthy();
    expect(updated.signature).not.toBe(originalSignature);
    const verified = await verifyLicenseSignature(updated);
    expect(verified.ok).toBe(true);
  });

  it('set-tier re-signs and reset-device clears the binding', async () => {
    const store = makeStore();
    const user = makeUser();
    const plan = makePlan({ tier: 'bronze' });
    const purchase = makePurchase(user);
    const license = await buildLicenseForPurchase(store.doc, user, plan, purchase);
    store.doc.licenses.push(license);

    await checkLicense(store, license.key, 'device-aaaa', { bind: true });
    expect(store.doc.licenses[0]!.deviceId).toBe('device-aaaa');

    await setLicenseTier(store, license.id, 'DIAMOND');
    const upgraded = store.doc.licenses[0]!;
    expect(upgraded.tier).toBe('DIAMOND');
    const verified = await verifyLicenseSignature(upgraded);
    expect(verified.ok).toBe(true);

    resetLicenseDevice(store.doc, license.id);
    expect(store.doc.licenses[0]!.deviceId).toBeUndefined();
    expect(store.doc.licenses[0]!.transferCount).toBe(1);
    // After the reset, the old device is rejected as a "different" device path
    // (unbound again, so it binds to whatever activates first).
    const rebound = await checkLicense(store, license.key, 'device-cccc', { bind: true });
    expect(rebound.ok).toBe(true);
    expect(store.doc.licenses[0]!.deviceId).toBe('device-cccc');
  });
});
