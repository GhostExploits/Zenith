/**
 * In-memory rate limiter (development-grade).
 *
 * Protects sensitive endpoints from brute-force and abuse. Buckets are
 * configured per key prefix so different endpoints get appropriate limits.
 *
 * IMPORTANT: memory is per-isolate. On Cloudflare this limits each worker
 * instance independently, which is still meaningful protection but not a hard
 * global cap. For production hardening, pair this with Cloudflare Rate
 * Limiting rules (dashboard → Security) or a KV/D1-backed counter — this
 * module is the single integration point, so swapping the backend only
 * touches `isRateLimited` / `recordHit`.
 */

const DEFAULT_MAX = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

/** Per-bucket limits, keyed by the prefix before the first ':' in the key. */
const BUCKETS: Record<string, { max: number; windowMs: number }> = {
  // Authentication attempts (brute-force protection).
  signin: { max: 10, windowMs: 15 * 60 * 1000 },
  signup: { max: 5, windowMs: 60 * 60 * 1000 },
  forgot: { max: 5, windowMs: 15 * 60 * 1000 },
  reset: { max: 5, windowMs: 15 * 60 * 1000 },
  support: { max: 5, windowMs: 15 * 60 * 1000 },
  // OAuth callback abuse (each attempt does token validation work).
  oauth: { max: 10, windowMs: 15 * 60 * 1000 },
  // Admin API mutations.
  admin: { max: 30, windowMs: 15 * 60 * 1000 },
  // Release downloads.
  download: { max: 30, windowMs: 15 * 60 * 1000 },
};

const buckets = new Map<string, number[]>();

function configFor(key: string): { max: number; windowMs: number } {
  const prefix = key.slice(0, key.indexOf(':') === -1 ? key.length : key.indexOf(':'));
  return BUCKETS[prefix] ?? { max: DEFAULT_MAX, windowMs: DEFAULT_WINDOW_MS };
}

function prune(key: string, now: number): number[] {
  const { windowMs } = configFor(key);
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  buckets.set(key, hits);
  return hits;
}

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = prune(key, now);
  return hits.length >= configFor(key).max;
}

export function recordHit(key: string): void {
  const now = Date.now();
  prune(key, now);
  buckets.get(key)!.push(now);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, hits] of buckets) {
      if (hits.length === 0 || now - hits[hits.length - 1] > DEFAULT_WINDOW_MS) buckets.delete(k);
    }
  }
}

/** Best-effort client IP: Cloudflare sets cf-connecting-ip; dev falls back. */
export function clientKey(request: Request): string {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return ip;
}
