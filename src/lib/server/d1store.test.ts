import { describe, it, expect, beforeEach } from 'vitest';
import type { DbDocument } from '../types';
import type { D1DatabaseLike, D1PreparedStatement } from './runtime';
import { D1Store } from './store';

/**
 * A minimal in-memory D1 that speaks exactly the statements D1Store issues,
 * plus helpers to simulate a concurrent writer committing between our read
 * and our write (how real multi-isolate races manifest).
 */
class FakeD1 implements D1DatabaseLike {
  private rows = new Map<string, { doc: string; rev: number }>();
  /** Fired before every UPDATE executes — used to inject concurrent writes. */
  onBeforeUpdate?: (self: FakeD1) => void;

  /** Simulate another isolate committing a change directly. */
  concurrentWrite(mutate: (doc: DbDocument) => void): void {
    const row = this.rows.get('doc');
    if (!row) throw new Error('No doc row to race against');
    const doc = JSON.parse(row.doc) as DbDocument;
    mutate(doc);
    this.rows.set('doc', { doc: JSON.stringify(doc), rev: row.rev + 1 });
  }

  prepare(sql: string): D1PreparedStatement {
    // Mirrors the real D1 API: prepare() returns a statement that can be
    // bound (optional) and then run()/first() executes with the bound values.
    const values: unknown[] = [];
    const statement: D1PreparedStatement = {
      bind: (...args: unknown[]) => {
        values.push(...args);
        return statement;
      },
      run: async () => {
        if (sql.startsWith('CREATE TABLE')) {
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith('INSERT OR IGNORE')) {
          const [key, doc] = [String(values[0]), String(values[1])];
          if (!this.rows.has(key)) this.rows.set(key, { doc, rev: 1 });
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith('UPDATE store')) {
          this.onBeforeUpdate?.(this);
          const [doc, key, expectedRev] = [String(values[0]), String(values[1]), Number(values[2])];
          const row = this.rows.get(key);
          if (row && row.rev === expectedRev) {
            this.rows.set(key, { doc, rev: row.rev + 1 });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith('SELECT doc')) {
          return { meta: { changes: 0 } }; // reads go through first()
        }
        throw new Error(`Unsupported SQL in test: ${sql}`);
      },
      first: async <T>() => {
        if (sql.startsWith('SELECT doc')) {
          const row = this.rows.get(String(values[0]));
          if (!row) return null as T | null;
          const out: Record<string, unknown> = { doc: row.doc };
          if (sql.includes('rev')) out.rev = row.rev;
          return out as T;
        }
        throw new Error(`Unsupported first() SQL in test: ${sql}`);
      },
      all: async <T>() => {
        throw new Error(`Unsupported all() SQL in test: ${sql}`);
      },
    };
    return statement;
  }
}

describe('D1Store', () => {
  let fake: FakeD1;

  beforeEach(() => {
    fake = new FakeD1();
  });

  it('seeds an empty database and serves it', async () => {
    const store = await D1Store.create(fake);
    const db = store.db();
    expect(db.users.length).toBeGreaterThan(0); // owner seeded
    expect(db.plans.length).toBeGreaterThan(0); // catalog seeded
  });

  it('persists mutations', async () => {
    const store = await D1Store.create(fake);
    await store.mutate((db) => {
      db.users.push({
        id: 'user-x',
        email: 'x@example.com',
        displayName: 'X',
        passwordHash: '',
        passwordScheme: 'pbkdf2-sha256',
        salt: '',
        iterations: 1,
        role: 'user',
        emailVerified: false,
        suspended: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    expect(store.db().users.some((u) => u.id === 'user-x')).toBe(true);
  });

  it('retries and survives a concurrent write (no lost update)', async () => {
    const store = await D1Store.create(fake);

    // Simulate another isolate committing right before our UPDATE: the first
    // attempt loses the CAS, the retry re-applies on the fresh base.
    let injected = false;
    fake.onBeforeUpdate = () => {
      if (!injected) {
        injected = true;
        fake.concurrentWrite((doc) => {
          doc.users.push({
            id: 'user-concurrent',
            email: 'concurrent@example.com',
            displayName: 'Concurrent',
            passwordHash: '',
            passwordScheme: 'pbkdf2-sha256',
            salt: '',
            iterations: 1,
            role: 'user',
            emailVerified: false,
            suspended: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        });
      }
    };

    await store.mutate((db) => {
      db.users.push({
        id: 'user-ours',
        email: 'ours@example.com',
        displayName: 'Ours',
        passwordHash: '',
        passwordScheme: 'pbkdf2-sha256',
        salt: '',
        iterations: 1,
        role: 'user',
        emailVerified: false,
        suspended: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    const finalDoc = store.db();
    expect(finalDoc.users.some((u) => u.id === 'user-ours')).toBe(true);
    expect(finalDoc.users.some((u) => u.id === 'user-concurrent')).toBe(true);
  });

  it('refresh() re-reads the latest committed document', async () => {
    const store = await D1Store.create(fake);
    // Another isolate writes directly to the backing store.
    fake.concurrentWrite((doc) => {
      doc.users.push({
        id: 'user-remote',
        email: 'remote@example.com',
        displayName: 'Remote',
        passwordHash: '',
        passwordScheme: 'pbkdf2-sha256',
        salt: '',
        iterations: 1,
        role: 'user',
        emailVerified: false,
        suspended: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    await store.refresh();
    expect(store.db().users.some((u) => u.id === 'user-remote')).toBe(true);
  });
});
