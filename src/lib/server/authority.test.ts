import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalPayload,
  entitlementFields,
  publicKeyPem,
  signEntitlement,
  verifyLicenseSignature,
  MAX_DEVICES,
  PRODUCT_ID,
  LICENSE_VERSION,
} from './authority';
import type { License } from '../types';

function pemToPkcs8(privatePem: string): string {
  // The private key PEM from node:crypto is already PKCS8 ("PRIVATE KEY").
  return privatePem;
}

describe('canonicalPayload', () => {
  it('matches the VapeService payload byte-for-byte', () => {
    // Expected string produced by the Java implementation
    // (LicenseStore.canonicalPayload) for these exact fields.
    const payload = canonicalPayload({
      licenseId: '00000000-0000-0000-0000-000000000000',
      issuedAtMs: 1_750_000_000_000,
      expiresAtMs: 0,
      recipient: 'buyer@example.com',
      tier: 'GOLD',
    });
    expect(payload).toBe(
      '{"licenseId":"00000000-0000-0000-0000-000000000000","product":"zenith-v2","issuedAt":1750000000000,' +
        '"expiresAt":0,"recipient":"buyer@example.com","licenseVersion":1,"maxDevices":1,"tier":"GOLD"}',
    );
    expect(PRODUCT_ID).toBe('zenith-v2');
    expect(LICENSE_VERSION).toBe(1);
    expect(MAX_DEVICES).toBe(1);
  });

  it('escapes quotes/backslashes in the recipient and uppercases the tier', () => {
    const payload = canonicalPayload({
      licenseId: 'abc',
      issuedAtMs: 1,
      expiresAtMs: 0,
      recipient: 'a"b\\c',
      tier: 'gold',
    });
    expect(payload).toContain('"recipient":"a\\"b\\\\c"');
    expect(payload).toContain('"tier":"GOLD"');
  });
});

describe('signing with an explicit PEM key (production path)', () => {
  let privatePem: string;
  let publicPem: string;

  beforeEach(() => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    privatePem = pemToPkcs8(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    vi.stubEnv('LICENSE_SIGNING_KEY', privatePem);
    vi.stubEnv('LICENSE_SIGNING_PUBLIC_KEY', publicPem);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs and verifies with the configured key', async () => {
    const fields = {
      licenseId: '11111111-1111-1111-1111-111111111111',
      issuedAtMs: Date.now(),
      expiresAtMs: 0,
      recipient: 'owner@example.com',
      tier: 'DIAMOND',
    };
    const signature = await signEntitlement(fields);
    // base64url, no padding, exactly 64 bytes → 86 chars (64 bytes * 4/3).
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(signature).not.toContain('=');

    const license: License = {
      id: 'license-test',
      key: 'ZEN-TEST-TEST-TEST',
      licenseId: fields.licenseId,
      userId: 'u1',
      productId: 'zenith-v2',
      planId: 'zenith-gold',
      kind: 'permanent',
      status: 'active',
      tier: 'DIAMOND',
      recipient: fields.recipient,
      issuedAt: new Date(fields.issuedAtMs).toISOString(),
      transferCount: 0,
      activationHistory: [],
      signature,
    };
    const verified = await verifyLicenseSignature(license);
    expect(verified.ok).toBe(true);
  });

  it('detects a tampered record (wrong tier) via the stored signature', async () => {
    const license: License = {
      id: 'license-test',
      key: 'ZEN-TEST-TEST-TEST',
      licenseId: '22222222-2222-2222-2222-222222222222',
      userId: 'u1',
      productId: 'zenith-v2',
      planId: 'zenith-silver',
      kind: 'subscription',
      status: 'active',
      tier: 'SILVER',
      recipient: 't@example.com',
      issuedAt: new Date().toISOString(),
      transferCount: 0,
      activationHistory: [],
    };
    license.signature = await signEntitlement(entitlementFields(license));
    const before = await verifyLicenseSignature(license);
    expect(before.ok).toBe(true);

    // Forge the record: bump the tier after signing.
    license.tier = 'DIAMOND';
    const after = await verifyLicenseSignature(license);
    expect(after.ok).toBe(false);
  });

  it('serves the public key as PEM', async () => {
    const pem = await publicKeyPem();
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).toContain('-----END PUBLIC KEY-----');
  });
});
