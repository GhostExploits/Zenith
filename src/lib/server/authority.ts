/**
 * License authority — the server half of the Zenith client's licensing
 * contract.
 *
 * The Zenith client (VapeV4.21) verifies every license locally: the owner's
 * Ed25519 public key is embedded in the client, and a license is a canonical
 * entitlement payload signed with the matching private key. This module
 * produces and verifies those signatures so the website can act as the remote
 * license authority — the same contract the VapeService exposes locally
 * (`/license/activate`, `/license/status`, `/license/public-key`).
 *
 * The payload format, field order and values MUST stay byte-for-byte
 * compatible with VapeService `LicenseStore.canonicalPayload` — the client
 * parses the payload with a regex and rejects anything else. Field order is
 * fixed so the signature is deterministic. The payload never contains the
 * device hash or license status: device binding is enforced by the authority
 * and re-checked by the client, and status changes never invalidate a
 * signature.
 *
 * Key material comes from environment secrets:
 *   LICENSE_SIGNING_KEY          PKCS8 PEM private key (from the owner's
 *                                VapeService data dir: license-signing.key).
 *                                The CLIENT only accepts signatures from the
 *                                matching key — an ephemeral dev key produces
 *                                licenses real clients will reject.
 *   LICENSE_SIGNING_PUBLIC_KEY   X.509 PEM public key (license-signing.pub).
 *                                Used for tamper checks of stored records.
 *                                Optional: when absent, the public key is
 *                                derived where the runtime allows it.
 */
import type { License } from '../types';

export const PRODUCT_ID = 'zenith-v2';
export const LICENSE_VERSION = 1;
export const MAX_DEVICES = 1;
export const TIERS = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'] as const;
export type LicenseTier = (typeof TIERS)[number];

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Base64 / PEM helpers
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  // Accept base64url (signatures are url-safe, unpadded) and standard base64.
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
}

function encodeText(value: string): Uint8Array<ArrayBuffer> {
  return enc.encode(value);
}

function spkiToPem(spki: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(spki)) bin += String.fromCharCode(b);
  const body = btoa(bin).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

let cachedPrivateKey: CryptoKey | null = null;
let cachedPublicKeyPem: string | null = null;
let canVerify = true;
const keyWarnings: string[] = [];

/** True when a real (owner-provided) signing key is configured. */
export function signingKeyConfigured(): boolean {
  return Boolean((import.meta.env.LICENSE_SIGNING_KEY as string | undefined)?.trim());
}

/** Warnings about the current signing configuration (shown in the admin panel). */
export function authorityWarnings(): string[] {
  return [...keyWarnings];
}

function derivePublicKeyPem(privatePem: string): Promise<string | null> {
  // Node-only helper (dev/tests): derive the SPKI from the PKCS8 private key.
  // Cloudflare Workers expose the public key via LICENSE_SIGNING_PUBLIC_KEY.
  return import('node:crypto')
    .then(({ createPublicKey }) => {
      const pub = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' });
      return typeof pub === 'string' ? pub : pub.toString();
    })
    .catch(() => null);
}

interface ResolvedKey {
  privateKey: CryptoKey;
  publicKeyPem: string | null;
  canVerify: boolean;
}

async function resolveKey(): Promise<ResolvedKey> {
  if (cachedPrivateKey && cachedPublicKeyPem !== null) {
    return { privateKey: cachedPrivateKey, publicKeyPem: cachedPublicKeyPem, canVerify };
  }

  const privatePem = (import.meta.env.LICENSE_SIGNING_KEY as string | undefined)?.trim();
  const publicPem = (import.meta.env.LICENSE_SIGNING_PUBLIC_KEY as string | undefined)?.trim();

  if (privatePem) {
    cachedPrivateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(privatePem),
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    if (publicPem) {
      cachedPublicKeyPem = publicPem;
      canVerify = true;
    } else {
      const derived = await derivePublicKeyPem(privatePem);
      cachedPublicKeyPem = derived;
      canVerify = derived !== null;
      if (!canVerify) {
        keyWarnings.push(
          'LICENSE_SIGNING_PUBLIC_KEY is not set — stored-license tamper checks are skipped. ' +
            'Set it to the matching license-signing.pub for full integrity verification.',
        );
      }
    }
    return { privateKey: cachedPrivateKey, publicKeyPem: cachedPublicKeyPem, canVerify };
  }

  // Dev fallback: an ephemeral keypair per worker instance. Real Zenith
  // clients will NOT accept licenses signed with this key.
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  cachedPrivateKey = pair.privateKey;
  cachedPublicKeyPem = spkiToPem(await crypto.subtle.exportKey('spki', pair.publicKey));
  canVerify = true;
  keyWarnings.push(
    'LICENSE_SIGNING_KEY is not set — using an ephemeral signing key. Real Zenith clients will reject ' +
      'licenses issued this way. Set LICENSE_SIGNING_KEY to the PKCS8 PEM from VapeService/data/license-signing.key.',
  );
  return { privateKey: cachedPrivateKey, publicKeyPem: cachedPublicKeyPem, canVerify };
}

/** The PEM public key served to clients at /license/public-key. */
export async function publicKeyPem(): Promise<string> {
  const pem = (await resolveKey()).publicKeyPem;
  if (!pem) {
    throw new Error('The license authority public key is not available in this environment. Set LICENSE_SIGNING_PUBLIC_KEY.');
  }
  return pem;
}

// ---------------------------------------------------------------------------
// Canonical entitlement payload
// ---------------------------------------------------------------------------

export interface EntitlementFields {
  licenseId: string;
  /** Epoch millis. */
  issuedAtMs: number;
  /** Epoch millis; 0 = perpetual. */
  expiresAtMs: number;
  recipient: string;
  tier: string;
}

function jsonEscape(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        if (ch.charCodeAt(0) < 0x20) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
        else out += ch;
    }
  }
  return out;
}

/**
 * Byte-for-byte equivalent of VapeService `LicenseStore.canonicalPayload`.
 * Field order is significant — do not reorder.
 */
export function canonicalPayload(fields: EntitlementFields): string {
  return (
    '{"licenseId":"' +
    jsonEscape(fields.licenseId) +
    '","product":"' +
    PRODUCT_ID +
    '","issuedAt":' +
    fields.issuedAtMs +
    ',"expiresAt":' +
    fields.expiresAtMs +
    ',"recipient":"' +
    jsonEscape(fields.recipient) +
    '","licenseVersion":' +
    LICENSE_VERSION +
    ',"maxDevices":' +
    MAX_DEVICES +
    ',"tier":"' +
    jsonEscape(fields.tier.toUpperCase()) +
    '"}'
  );
}

/** Extract the entitlement fields from a stored license record. */
export function entitlementFields(license: License): EntitlementFields {
  return {
    licenseId: license.licenseId,
    issuedAtMs: new Date(license.issuedAt).getTime(),
    expiresAtMs: license.expiresAt ? new Date(license.expiresAt).getTime() : 0,
    recipient: license.recipient ?? '',
    tier: license.tier,
  };
}

/** Sign an entitlement payload; returns base64url (matches Java withoutPadding). */
export async function signEntitlement(fields: EntitlementFields): Promise<string> {
  const { privateKey } = await resolveKey();
  const sig = await crypto.subtle.sign('Ed25519', privateKey, encodeText(canonicalPayload(fields)));
  return bytesToBase64Url(new Uint8Array(sig));
}

/** (Re)sign a license record in place after any payload-affecting change. */
export async function signLicense(license: License): Promise<License> {
  license.signature = await signEntitlement(entitlementFields(license));
  return license;
}

export interface SignatureVerification {
  ok: boolean;
  /** The canonical payload that was (or would be) verified. */
  payload: string;
}

/**
 * Verify a stored license's signature against its own fields (tamper check).
 * When the public key is unavailable (see resolveKey), verification is skipped
 * and `ok` is true — the record is server-controlled, and the authoritative
 * check always happens client-side with the embedded key.
 */
export async function verifyLicenseSignature(license: License): Promise<SignatureVerification> {
  const payload = canonicalPayload(entitlementFields(license));
  if (!license.signature) return { ok: false, payload };
  const { publicKeyPem: pem, canVerify: verify } = await resolveKey();
  if (!verify || !pem) return { ok: true, payload };
  try {
    const pub = await crypto.subtle.importKey(
      'spki',
      pemToDer(pem),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify('Ed25519', pub, base64ToBytes(license.signature), encodeText(payload));
    return { ok, payload };
  } catch {
    return { ok: false, payload };
  }
}
