/**
 * License system — issued from verified server-side payment events (or by an
 * admin from the panel), never from frontend state.
 *
 * A license is a signed Zenith entitlement: the record carries an Ed25519
 * signature over a canonical payload (see ./authority.ts) that the Zenith
 * client verifies locally against the public key embedded in the client. The
 * key format and payload match the existing VapeService license authority, so
 * keys issued here work in the real client without modification.
 *
 * Device binding: each license binds to ONE machine fingerprint (SHA-256 of
 * "zenith-v2:" + Windows MachineGuid) on first activation. A license already
 * bound to another device is rejected with LICENSE_BOUND_OTHER; only the owner
 * can reset a binding (admin panel) — customers cannot self-reset, which is
 * what stops one key being shared across machines.
 */
import type { DbDocument, License, Plan, Purchase, Subscription, User } from '../types';
import type { Store } from './store';
import { entitlementFields, signEntitlement, signLicense, verifyLicenseSignature, canonicalPayload, TIERS } from './authority';
import { notify } from './notifications';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const KEY_PREFIX = 'ZEN-';
const KEY_GROUPS = 3;
const KEY_GROUP_LEN = 4;

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/** ZEN-XXXX-XXXX-XXXX from a CSPRNG (same alphabet/format as the VapeService). */
export function generateLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_GROUPS * KEY_GROUP_LEN));
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i++) chars.push(KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length]);
  const groups: string[] = [];
  for (let g = 0; g < KEY_GROUPS; g++) {
    groups.push(chars.slice(g * KEY_GROUP_LEN, (g + 1) * KEY_GROUP_LEN).join(''));
  }
  return `${KEY_PREFIX}${groups.join('-')}`;
}

/** A unique key within the current document. */
export function generateUniqueLicenseKey(db: DbDocument): string {
  const existing = new Set(db.licenses.map((l) => l.key));
  let key = generateLicenseKey();
  let guard = 0;
  while (existing.has(key) && guard < 20) {
    key = generateLicenseKey();
    guard++;
  }
  return key;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** The status a license effectively has right now (expiry is computed, not stored). */
export function licenseEffectiveStatus(license: License): License['status'] {
  if (license.status === 'revoked' || license.status === 'suspended') return license.status;
  if (license.expiresAt && new Date(license.expiresAt).getTime() < Date.now()) return 'expired';
  return license.status;
}

/** The client-facing status string (the client requires exactly "ACTIVE"). */
export function authorityStatus(license: License): string {
  switch (licenseEffectiveStatus(license)) {
    case 'active':
      return 'ACTIVE';
    case 'expired':
      return 'EXPIRED';
    case 'revoked':
      return 'REVOKED';
    default:
      return 'INACTIVE';
  }
}

export function licenseStatusLabel(status: License['status']): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
    case 'suspended':
      return 'Suspended';
    case 'unused':
      return 'Unused';
  }
}

export function isLicenseUsable(license: License): boolean {
  return licenseEffectiveStatus(license) === 'active';
}

// ---------------------------------------------------------------------------
// Issuance (signs the entitlement — must run before any store mutate)
// ---------------------------------------------------------------------------

function baseLicense(
  db: DbDocument,
  user: User,
  plan: Plan,
  opts: {
    purchase?: Purchase;
    subscription?: Subscription;
    status?: License['status'];
    expiresAt?: string;
    notes?: string;
  } = {},
): License {
  const now = new Date().toISOString();
  return {
    id: `license-${randomId()}`,
    key: generateUniqueLicenseKey(db),
    licenseId: crypto.randomUUID(),
    userId: user.id,
    productId: plan.productId,
    planId: plan.id,
    purchaseId: opts.purchase?.id,
    ...(opts.subscription ? { subscriptionId: opts.subscription.id } : {}),
    kind: plan.licenseMode === 'permanent' ? 'permanent' : 'subscription',
    status: opts.status ?? 'active',
    tier: plan.tier.toUpperCase() as License['tier'],
    recipient: user.email,
    issuedAt: now,
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
    transferCount: 0,
    activationHistory: [],
  };
}

/**
 * Build the license a verified purchase entitles the user to, SIGNED. Does not
 * push — callers persist it inside a store.mutate (idempotently).
 *
 * Subscriptions get a license tied to the current period end; one-time
 * (permanent) purchases get a license that never expires.
 */
export async function buildLicenseForPurchase(
  db: DbDocument,
  user: User,
  plan: Plan,
  purchase: Purchase,
  subscription?: Subscription,
): Promise<License> {
  const now = new Date().toISOString();
  const license = baseLicense(db, user, plan, { purchase, subscription });
  if (plan.licenseMode === 'subscription-period' && subscription?.currentPeriodEnd) {
    license.expiresAt = subscription.currentPeriodEnd;
  }
  license.activatedAt = now;
  license.activationHistory = [{ at: now }];
  await signLicense(license);
  return license;
}

/** Build an admin-issued license, SIGNED. Not tied to a purchase yet; unused until redeemed. */
export async function buildManualLicense(
  db: DbDocument,
  user: User,
  plan: Plan,
  opts?: { expiresAt?: string; notes?: string },
): Promise<License> {
  const license = baseLicense(db, user, plan, {
    status: 'unused',
    expiresAt: opts?.expiresAt,
    notes: opts?.notes,
  });
  await signLicense(license);
  return license;
}

// ---------------------------------------------------------------------------
// Status mutations (no re-sign needed — status is not part of the payload)
// ---------------------------------------------------------------------------

export function revokeLicense(db: DbDocument, licenseId: string, reason?: string): License | null {
  const license = db.licenses.find((l) => l.id === licenseId);
  if (!license) return null;
  license.status = 'revoked';
  license.revokedAt = new Date().toISOString();
  license.notes = reason ? `${license.notes ? license.notes + ' — ' : ''}${reason}` : license.notes;
  return license;
}

export function reactivateLicense(db: DbDocument, licenseId: string): License | null {
  const license = db.licenses.find((l) => l.id === licenseId);
  if (!license) return null;
  license.status = 'active';
  license.revokedAt = undefined;
  license.activatedAt = license.activatedAt ?? new Date().toISOString();
  return license;
}

export function suspendLicense(db: DbDocument, licenseId: string): License | null {
  const license = db.licenses.find((l) => l.id === licenseId);
  if (!license) return null;
  license.status = 'suspended';
  return license;
}

/**
 * Clear a license's device binding (owner-only action — customers cannot do
 * this themselves). Used to transfer a license to a new machine.
 */
export function resetLicenseDevice(db: DbDocument, licenseId: string): License | null {
  const license = db.licenses.find((l) => l.id === licenseId);
  if (!license) return null;
  license.deviceId = undefined;
  license.boundAt = undefined;
  license.transferCount = (license.transferCount ?? 0) + 1;
  return license;
}

// ---------------------------------------------------------------------------
// Payload-affecting mutations (re-sign — expiry/tier are part of the payload)
// ---------------------------------------------------------------------------

/**
 * Extend (or set) a license expiry by a number of days, re-signing the
 * payload. Expiry is part of the signed entitlement, so the signature is
 * recomputed against the new value and persisted atomically with it.
 */
export async function extendLicense(store: Store, licenseId: string, days: number): Promise<License | null> {
  if (!Number.isFinite(days) || days <= 0) return null;
  const license = store.db().licenses.find((l) => l.id === licenseId);
  if (!license) return null;
  const base = license.expiresAt ? new Date(license.expiresAt).getTime() : Date.now();
  const next = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
  const signature = await signEntitlement(entitlementFields({ ...license, expiresAt: next } as License));
  await store.mutate((d) => {
    const l = d.licenses.find((x) => x.id === licenseId);
    if (!l) return;
    l.expiresAt = next;
    l.signature = signature;
    if (l.status === 'expired') l.status = 'active';
  });
  return store.db().licenses.find((l) => l.id === licenseId) ?? null;
}

/** Change a license's tier, re-signing the payload. Tier is part of the signed entitlement. */
export async function setLicenseTier(store: Store, licenseId: string, tier: string): Promise<License | null> {
  const normalized = tier.trim().toUpperCase();
  if (!TIERS.includes(normalized as (typeof TIERS)[number])) return null;
  const license = store.db().licenses.find((l) => l.id === licenseId);
  if (!license) return null;
  const signature = await signEntitlement(entitlementFields({ ...license, tier: normalized } as License));
  await store.mutate((d) => {
    const l = d.licenses.find((x) => x.id === licenseId);
    if (!l) return;
    l.tier = normalized as License['tier'];
    l.signature = signature;
  });
  return store.db().licenses.find((l) => l.id === licenseId) ?? null;
}

export function findLicenseByKey(db: DbDocument, key: string): License | undefined {
  const normalized = key.trim().toUpperCase();
  return db.licenses.find((l) => l.key === normalized);
}

// ---------------------------------------------------------------------------
// Authority checks (client + loader contract)
// ---------------------------------------------------------------------------

export interface LicenseCheckResult {
  ok: boolean;
  code: string;
  message: string;
  license?: License;
  payload?: string;
  signature?: string;
  token?: string;
}

/** The failure codes the loader/client map to user-facing messages. */
export const LICENSE_CODES = {
  INVALID: 'LICENSE_INVALID',
  TAMPERED: 'LICENSE_TAMPERED',
  REVOKED: 'LICENSE_REVOKED',
  INACTIVE: 'LICENSE_INACTIVE',
  EXPIRED: 'LICENSE_EXPIRED',
  BOUND_OTHER: 'LICENSE_BOUND_OTHER',
} as const;

/** Mint an opaque session token for the loader (mirrors the VapeService). */
export function mintLoaderToken(): string {
  return randomId() + randomId();
}

/**
 * Validate a license key and (optionally) bind it to a device.
 *
 * `bind` is used by the loader login (first use binds the machine). The client
 * status check passes `bind: false` — it verifies the binding matches.
 *
 * Returns the signed payload + signature the client verifies locally. All
 * rejection paths return the same shape with `ok: false` and a stable code.
 */
export async function checkLicense(
  store: Store,
  key: string,
  deviceId: string | undefined,
  opts: { bind?: boolean; clientVersion?: string; ip?: string } = {},
): Promise<LicenseCheckResult> {
  const normalized = key.trim().toUpperCase();
  if (!normalized) {
    return { ok: false, code: LICENSE_CODES.INVALID, message: 'License key not recognized' };
  }
  const db = store.db();
  const license = db.licenses.find((l) => l.key === normalized);
  if (!license) {
    return { ok: false, code: LICENSE_CODES.INVALID, message: 'License key not recognized' };
  }

  // Tamper check: the stored signature must match the record's own fields.
  if (license.signature) {
    const verified = await verifyLicenseSignature(license);
    if (!verified.ok) {
      return { ok: false, code: LICENSE_CODES.TAMPERED, message: 'License record failed integrity check' };
    }
  }

  const status = licenseEffectiveStatus(license);
  if (status === 'revoked') {
    return { ok: false, code: LICENSE_CODES.REVOKED, message: 'This license has been revoked' };
  }
  if (status === 'suspended') {
    return { ok: false, code: LICENSE_CODES.INACTIVE, message: 'This license is inactive' };
  }
  if (status === 'expired') {
    return { ok: false, code: LICENSE_CODES.EXPIRED, message: 'This license has expired' };
  }

  const device = deviceId ? deviceId.trim().toLowerCase() : '';
  let boundNow = false;

  if (license.deviceId) {
    if (device && license.deviceId !== device) {
      return { ok: false, code: LICENSE_CODES.BOUND_OTHER, message: 'This license is already activated on another device' };
    }
  } else if (opts.bind && device) {
    // Bind under the mutate lock so two concurrent activations cannot both win.
    await store.mutate((d) => {
      const l = d.licenses.find((x) => x.key === normalized);
      if (!l || l.deviceId) return;
      l.deviceId = device;
      l.boundAt = new Date().toISOString();
      l.transferCount = l.transferCount ?? 0;
      l.status = 'active';
      l.activatedAt = l.activatedAt ?? new Date().toISOString();
      l.activationHistory.push({ at: new Date().toISOString(), ip: opts.ip, hwid: device });
      l.activationHistory = l.activationHistory.slice(-50);
      boundNow = true;
    });
  }

  // Refresh last-seen (throttled to ~5 minutes so client polls stay cheap).
  const lastSeen = license.lastSeenAt ? new Date(license.lastSeenAt).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen > 5 * 60 * 1000 || (opts.clientVersion && opts.clientVersion !== license.clientVersion)) {
    await store.mutate((d) => {
      const l = d.licenses.find((x) => x.key === normalized);
      if (!l) return;
      l.lastSeenAt = new Date().toISOString();
      if (opts.clientVersion) l.clientVersion = opts.clientVersion;
    });
  }

  if (boundNow) {
    await notify(
      store,
      'license',
      'License activated',
      `${license.key} (${license.tier}) was activated on a new device${opts.ip ? ` from ${opts.ip}` : ''}.`,
    );
  }

  // Re-read so the response reflects any concurrent admin edits (tier/signature).
  const fresh = store.db().licenses.find((l) => l.key === normalized) ?? license;
  return {
    ok: true,
    code: authorityStatus(fresh),
    message: 'ok',
    license: fresh,
    payload: canonicalPayload(entitlementFields(fresh)),
    signature: fresh.signature,
  };
}

/**
 * HTTP body for the authority endpoints — the shape the loader and client
 * parse (see VapeService LicenseHttpHandler.activationJson):
 *
 *   success:  { successful, status, recipient, expiresAt, bound, deviceId,
 *               license, signedLicense:{payload,signature}, token? }
 *   failure:  { successful:false, code, error }
 *
 * Rejections are returned as HTTP 200 with `successful:false` — the loader
 * only reads the body on HTTP 200, and this keeps failure handling uniform.
 */
export function licenseCheckResponse(result: LicenseCheckResult, issueToken = false): Record<string, unknown> {
  const body: Record<string, unknown> = { successful: result.ok };
  if (result.license) {
    const rec = result.license;
    body.status = authorityStatus(rec);
    body.recipient = rec.recipient;
    body.expiresAt = rec.expiresAt ? new Date(rec.expiresAt).getTime() : 0;
    body.bound = Boolean(rec.deviceId);
    body.deviceId = rec.deviceId ?? null;
    body.license = rec;
  }
  if (result.payload && result.signature) {
    body.signedLicense = { payload: result.payload, signature: result.signature };
  }
  if (issueToken && result.ok) {
    body.token = result.token ?? mintLoaderToken();
  }
  if (!result.ok) {
    body.code = result.code;
    body.error = result.message;
  }
  return body;
}
