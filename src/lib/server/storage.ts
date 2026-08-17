/**
 * Protected release storage.
 *
 * Assets are NEVER placed in public/ — they are only reachable through the
 * entitlement-checked download endpoint.
 *
 *   - Dev:  files under ./data/storage (gitignored), seeded with placeholders.
 *   - Prod: Cloudflare R2 bucket bound as `STORAGE`. Files are streamed from
 *           the bucket only after the server-side entitlement check passes.
 *
 * R2 keys: releases/{releaseId}/{filename}
 */
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getR2 } from './runtime';

export interface StoredAsset {
  filename: string;
  sizeBytes: number;
  /** Buffered bytes (dev local files). */
  data?: Uint8Array;
  /** Streamable body (R2). Exactly one of data/body is set. */
  body?: ReadableStream;
}

/** Lazy storage path — computed only inside the dev-only method below. */
function storageDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../data/storage');
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function releaseKey(releaseId: string, filename: string): string {
  return `releases/${sanitize(releaseId)}/${sanitize(filename)}`;
}

/**
 * Resolve a release asset for delivery. Returns null when the file does not
 * exist — callers must already have verified entitlement.
 */
export async function getStoredAsset(releaseId: string, filename: string): Promise<StoredAsset | null> {
  // Dev always uses the local file store (the dev platform proxy exposes the
  // R2 binding, but the local bucket is empty and files live under ./data).
  if (!import.meta.env.DEV) {
    const r2 = getR2();
    if (r2) {
      const obj = await r2.get(releaseKey(releaseId, filename));
      if (!obj) return null;
      return { filename: sanitize(filename), sizeBytes: obj.size, body: obj.body ?? undefined };
    }
    // Production without R2 configured: no files to serve.
    return null;
  }
  const filePath = join(storageDir(), sanitize(releaseId), sanitize(filename));
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  return { filename: sanitize(filename), sizeBytes: stat.size, data: readFileSync(filePath) };
}

/**
 * Store a release asset (admin uploads). In dev this writes the local
 * placeholder directory so the flow can be tested; in production it writes R2.
 */
export async function putStoredAsset(
  releaseId: string,
  filename: string,
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
): Promise<void> {
  if (!import.meta.env.DEV) {
    const r2 = getR2();
    if (r2) {
      await r2.put(releaseKey(releaseId, filename), bytes, { httpMetadata: { contentType } });
      return;
    }
    throw new Error('Release storage (R2) is not configured in this environment.');
  }
  const dir = join(storageDir(), sanitize(releaseId));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sanitize(filename)), bytes);
}

/** Remove a stored release asset. */
export async function deleteStoredAsset(releaseId: string, filename: string): Promise<void> {
  if (!import.meta.env.DEV) {
    const r2 = getR2();
    if (r2) {
      await r2.delete(releaseKey(releaseId, filename));
    }
  }
}
