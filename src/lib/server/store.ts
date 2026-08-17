/**
 * Storage layer.
 *
 * The site talks to data through a thin `Store` interface so the database can
 * be swapped without touching domain logic:
 *
 *   - Dev:  JsonFileStore  — JSON file under ./data (gitignored), auto-seeded.
 *   - Prod: D1Store        — the whole document lives in one row of a Cloudflare
 *                            D1 database (SQLite). Reads are cached in the
 *                            worker isolate and refreshed per request via
 *                            middleware; writes are serialized per isolate and
 *                            use an optimistic compare-and-swap retry loop so
 *                            concurrent writes from multiple isolates never
 *                            lose an update.
 *
 * If neither is available (production without a D1 binding), the store reports
 * a clean "not configured" error and the public site keeps serving from static
 * content.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbDocument } from '../types';
import { emptyDb } from './schema';
import { seedIfEmpty } from './seed';
import { getD1, type D1DatabaseLike } from './runtime';

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
  /**
   * Optional: re-read the document from the underlying database. The D1 store
   * implements this so middleware can refresh the per-isolate cache before
   * every request; other stores no-op.
   */
  refresh?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Repairs documents written by older schema versions so the app never crashes
 * on a missing collection. Applied on every load (dev JSON + D1).
 */
export function normalizeDb(db: DbDocument): DbDocument {
  if (!Array.isArray(db.licenses)) db.licenses = [];
  if (!Array.isArray(db.notifications)) db.notifications = [];
  for (const p of db.plans ?? []) {
    if (p.licenseMode !== 'permanent') p.licenseMode = 'subscription-period';
  }
  db.schemaVersion = 2;
  return db;
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
      const seeded = normalizeDb(await seedIfEmpty(emptyDb()));
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
      return normalizeDb(JSON.parse(readFileSync(dataPaths().dbPath, 'utf-8')) as DbDocument);
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
// D1 store (production)
// ---------------------------------------------------------------------------

const DOC_KEY = 'doc';
const MAX_WRITE_ATTEMPTS = 8;

export async function initD1Schema(db: D1DatabaseLike): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS store (
         key TEXT PRIMARY KEY,
         doc TEXT NOT NULL,
         rev INTEGER NOT NULL
       )`,
    )
    .run();
}

export class D1Store implements Store {
  private cache: DbDocument | null = null;
  private rev = 0;
  private queue: Promise<void> = Promise.resolve();

  private constructor(private d1: D1DatabaseLike) {}

  static async create(d1: D1DatabaseLike): Promise<D1Store> {
    await initD1Schema(d1);
    const store = new D1Store(d1);
    await store.ensureSeeded();
    await store.refresh();
    return store;
  }

  /** Seed the document row once (idempotent across concurrent isolates). */
  private async ensureSeeded(): Promise<void> {
    const row = await this.d1
      .prepare('SELECT doc FROM store WHERE key = ?')
      .bind(DOC_KEY)
      .first<{ doc: string }>();
    if (row) return;
    const fresh = normalizeDb(await seedIfEmpty(emptyDb(), { production: true }));
    await this.d1
      .prepare('INSERT OR IGNORE INTO store (key, doc, rev) VALUES (?, ?, 1)')
      .bind(DOC_KEY, JSON.stringify(fresh))
      .run();
  }

  /** Load the latest document + revision from D1. */
  private async load(): Promise<{ doc: DbDocument; rev: number }> {
    const row = await this.d1
      .prepare('SELECT doc, rev FROM store WHERE key = ?')
      .bind(DOC_KEY)
      .first<{ doc: string; rev: number }>();
    if (!row) throw new StorageNotConfiguredError('The database has not been initialized.');
    return { doc: normalizeDb(JSON.parse(row.doc) as DbDocument), rev: row.rev };
  }

  async refresh(): Promise<void> {
    try {
      const { doc, rev } = await this.load();
      this.cache = doc;
      this.rev = rev;
    } catch (err) {
      // Keep serving the previous snapshot; callers surface real errors when
      // they try to mutate.
      console.error('[store] D1 refresh failed:', (err as Error).message);
    }
  }

  db(): DbDocument {
    if (!this.cache) throw new StorageNotConfiguredError('The database has not been loaded yet.');
    return this.cache;
  }

  mutate(fn: (db: DbDocument) => void): Promise<void> {
    this.queue = this.queue.then(async () => {
      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        // Each load() returns a fresh parsed document, so re-applying the
        // mutation on a retry starts from the newest committed base — a
        // push-style mutation is applied exactly once per committed base.
        const { doc, rev } = await this.load();
        this.rev = rev;
        const working = doc;
        fn(working);
        const res = await this.d1
          .prepare('UPDATE store SET doc = ?, rev = rev + 1 WHERE key = ? AND rev = ?')
          .bind(JSON.stringify(normalizeDb(working)), DOC_KEY, this.rev)
          .run();
        if (res.meta.changes === 1) {
          this.cache = working;
          this.rev += 1;
          return;
        }
        // Conflict: another isolate committed meanwhile — retry from its result.
      }
      throw new StorageNotConfiguredError(
        'The database is under heavy write load. Please try again in a moment.',
      );
    });
    return this.queue;
  }
}

// ---------------------------------------------------------------------------
// Unconfigured store (production without a database binding)
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

async function createStore(): Promise<Store> {
  if (import.meta.env.DEV) {
    return JsonFileStore.create();
  }
  const d1 = getD1();
  if (d1) {
    console.log('[store] Using Cloudflare D1 as the production store.');
    return D1Store.create(d1);
  }
  return new UnconfiguredStore();
}

export function getStore(): Promise<Store> {
  if (!cachedStore) {
    cachedStore = createStore();
  }
  return cachedStore;
}

/**
 * Re-read the store's snapshot from the database (no-op for stores that do
 * not implement `refresh`). Middleware calls this before every request so a
 * warm isolate never serves stale data.
 */
export async function refreshStore(): Promise<void> {
  try {
    const store = await getStore();
    await store.refresh?.();
  } catch {
    // Store unavailable — page/API handlers surface the clean 503 themselves.
  }
}

/** For tests / scripts: reset the cached store (dev only). */
export function resetStoreForTests(): void {
  cachedStore = null;
}
