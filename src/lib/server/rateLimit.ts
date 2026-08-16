/**
 * Minimal in-memory rate limiter (development-grade).
 *
 * Protects auth endpoints from obvious brute-force in dev. For production,
 * replace with a distributed limiter (Cloudflare Rate Limiting, KV-based
 * counters, or the provider's built-in protection) — this module is the
 * single integration point.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_HITS = 10;

const buckets = new Map<string, number[]>();

function prune(key: string, now: number): number[] {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  buckets.set(key, hits);
  return hits;
}

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = prune(key, now);
  return hits.length >= MAX_HITS;
}

export function recordHit(key: string): void {
  const now = Date.now();
  prune(key, now);
  buckets.get(key)!.push(now);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, hits] of buckets) {
      if (hits.length === 0 || now - hits[hits.length - 1] > WINDOW_MS) buckets.delete(k);
    }
  }
}

export function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
