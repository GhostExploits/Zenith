/**
 * Protected release storage.
 *
 * Assets are NEVER placed in public/ — they are only reachable through the
 * entitlement-checked download endpoint. Dev stores files under ./data/storage
 * (gitignored); production should use Cloudflare R2 with signed URLs, wired
 * through this interface.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StoredAsset {
  filename: string;
  sizeBytes: number;
  /**
   * Asset bytes, ready to serve. Dev files are small placeholders so this is
   * buffered; a real production backend should stream from R2 or redirect to
   * a short-lived signed URL instead of buffering large jars.
   */
  data: Uint8Array;
}

/** Lazy storage path — computed only inside the dev-only method below. */
function storageDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../data/storage');
}

/**
 * Resolve a release asset for delivery. Returns null when the file does not
 * exist (dev) — callers must already have verified entitlement.
 */
export async function getStoredAsset(releaseId: string, filename: string): Promise<StoredAsset | null> {
  if (!import.meta.env.DEV) {
    // Production: R2 with signed URLs or equivalent. Not configured yet.
    return null;
  }
  // Sanitize: only safe filename characters.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = join(storageDir(), releaseId.replace(/[^a-zA-Z0-9._-]/g, '_'), safeName);
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  return { filename: safeName, sizeBytes: stat.size, data: readFileSync(filePath) };
}
