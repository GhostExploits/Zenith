/**
 * Storage layer.
 *
 * The site talks to data through a thin `Store` interface so a real database
 * (Cloudflare D1, etc.) can replace the development store without touching
 * domain logic.
 *
 * Dev: JSON-file store under ./data (gitignored). Auto-seeds an admin account
 * and demo catalog on first use so `npm run dev` works out of the box.
 * Prod: no filesystem — the store reports a clean "not configured" error
 * until D1/other bindings are wired in (see README → Production backend).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbDocument } from '../types';
import { emptyDb } from './schema';
import { seedIfEmpty } from './seed';

/**
 * NOTE: no module-level filesystem work here. The file-store code is bundled
 * into the production worker (where it is never used), so any top-level
 * `fileURLToPath(import.meta.url)` would throw when the module loads on
 * Cloudflare. All path computation is lazy and only runs in dev.
 */

export class StorageNotConfiguredError extends Error {
  constructor(message = 'Database is not configured for this environment.') {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}

export interface Store {
  /** Snapshot of the database document. */
  db(): DbDocument;
  /** Apply a mutation to the document (serialized). */
  mutate(fn: (db: DbDocument) => void): Promise<void>;
}

// ---------------------------------------------------------------------------
// JSON file store (development only)
// ---------------------------------------------------------------------------

/** Lazy data paths — computed only inside dev-only methods. */
function dataPaths(): { dir: string; dbPath: string } {
  const base = dirname(fileURLToPath(import.meta.url));
  return { dir: join(base, '../../../data'), dbPath: join(base, '../../../data/db.json') };
}

class JsonFileStore implements Store {
  private doc: DbDocument | null = null;
  private queue: Promise<void> = Promise.resolve();

  static async create(): Promise<JsonFileStore> {
    const store = new JsonFileStore();
    const { dir, dbPath } = dataPaths();
    if (!existsSync(dbPath)) {
      mkdirSync(dir, { recursive: true });
      const seeded = await seedIfEmpty(emptyDb());
      writeFileSync(dbPath, JSON.stringify(seeded, null, 2));
      store.doc = seeded;
      console.warn(
        '[dev] Created data/db.json with a seeded development database ' +
          '(admin account from ADMIN_EMAIL / ADMIN_PASSWORD env vars).',
      );
    }
    return store;
  }

  private load(): DbDocument {
    try {
      return JSON.parse(readFileSync(dataPaths().dbPath, 'utf-8')) as DbDocument;
    } catch {
      throw new StorageNotConfiguredError('Could not read the local development database.');
    }
  }

  db(): DbDocument {
    if (!this.doc) this.doc = this.load();
    return this.doc;
  }

  mutate(fn: (db: DbDocument) => void): Promise<void> {
    this.queue = this.queue.then(async () => {
      const doc = this.db();
      fn(doc);
      this.doc = doc;
      try {
        writeFileSync(dataPaths().dbPath, JSON.stringify(doc, null, 2));
      } catch (err) {
        throw new StorageNotConfiguredError(`Could not write local database: ${(err as Error).message}`);
      }
    });
    return this.queue;
  }
}

// ---------------------------------------------------------------------------
// Production store placeholder
// ---------------------------------------------------------------------------

/** Throws a clean error until a production backend is wired in. */
class UnconfiguredStore implements Store {
  private fail(): never {
    throw new StorageNotConfiguredError();
  }
  db(): DbDocument {
    this.fail();
  }
  mutate(): Promise<void> {
    this.fail();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cachedStore: Promise<Store> | null = null;

export function getStore(): Promise<Store> {
  if (!cachedStore) {
    if (import.meta.env.DEV) {
      cachedStore = JsonFileStore.create();
    } else {
      cachedStore = Promise.resolve(new UnconfiguredStore());
    }
  }
  return cachedStore;
}

/** For tests / scripts: reset the cached store (dev only). */
export function resetStoreForTests(): void {
  cachedStore = null;
}
