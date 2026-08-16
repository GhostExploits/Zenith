/**
 * Development seed.
 *
 * Runs exactly once, when the local JSON database file is created. It creates
 * the initial admin account (credentials from ADMIN_EMAIL / ADMIN_PASSWORD env
 * vars, with documented dev defaults) and mirrors the static catalog content
 * into the database so admin-editable data starts populated.
 *
 * NEVER runs in production: production uses a real database provisioned
 * through migration scripts, and the store is unconfigured until then.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbDocument, User } from '../types';
import { hashPassword } from './auth';

const DEV_ADMIN_EMAIL = 'admin@zenith.local';
const DEV_ADMIN_PASSWORD = 'zenith-dev-admin';

/** Lazy path — never evaluated at module load (dev-only store). */
function storageDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../data/storage');
}

export async function seedIfEmpty(db: DbDocument): Promise<DbDocument> {
  await seedCatalogIntoDb(db);
  seedReleaseAssets(db);

  if (db.users.some((u) => u.role === 'owner' || u.role === 'admin')) return db;

  const adminEmail = (import.meta.env.ADMIN_EMAIL ?? DEV_ADMIN_EMAIL).trim().toLowerCase();
  const adminPassword = import.meta.env.ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD;

  const { hash, salt, iterations } = await hashPassword(adminPassword);
  const now = new Date().toISOString();

  const admin: User = {
    id: 'user-admin',
    email: adminEmail,
    displayName: 'Zenith Owner',
    passwordHash: hash,
    passwordScheme: 'pbkdf2-sha256',
    salt,
    iterations,
    role: 'owner',
    emailVerified: true,
    suspended: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };

  // Demo users so the admin Users table has something to look at (dev only).
  const demoUsers: User[] = [];
  for (const [i, name] of ['alex', 'sam'].entries()) {
    const { hash: h, salt: s, iterations: it } = await hashPassword('zenith-dev-password');
    demoUsers.push({
      id: `user-demo-${i}`,
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: h,
      passwordScheme: 'pbkdf2-sha256',
      salt: s,
      iterations: it,
      role: 'user',
      emailVerified: true,
      suspended: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Demo subscription so account pages render meaningfully (dev only).
  const periodEnd = new Date(Date.now() + 26 * 24 * 60 * 60 * 1000).toISOString();

  db.seededAt = now;
  db.users.push(admin, ...demoUsers);
  db.subscriptions.push({
    id: 'sub-demo-1',
    userId: 'user-demo-0',
    productId: 'zenith-v2',
    planId: 'zenith-v2-monthly',
    status: 'active',
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    provider: 'dev-seed',
    createdAt: now,
  });

  return db;
}

/**
 * Writes clearly-marked placeholder release files into the private dev
 * storage so the protected-download flow can be exercised end-to-end.
 * Never runs in production (seed only runs on fresh dev databases).
 */
function seedReleaseAssets(db: DbDocument): void {
  try {
    for (const release of db.releases) {
      if (!release.asset) continue;
      const dir = join(storageDir(), release.id.replace(/[^a-zA-Z0-9._-]/g, '_'));
      mkdirSync(dir, { recursive: true });
      const filename = release.asset.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      writeFileSync(
        join(dir, filename),
        `Zenith development placeholder release asset\n\n` +
          `Product: ${release.productId}\n` +
          `Version: ${release.version}\n` +
          `This file exists so the protected-download flow can be tested in development. ` +
          `Replace it with the real build artifact in data/storage (or R2 in production).\n`,
      );
    }
  } catch (err) {
    console.warn('[dev] Could not seed release assets:', (err as Error).message);
  }
}/**
 * Mirrors the static catalog into the database.
 * Called by the store on first creation so admin-managed pages (products,
 * plans, releases, FAQs, announcements) start populated. Subsequent admin
 * edits take precedence.
 */
export async function seedCatalogIntoDb(db: DbDocument): Promise<DbDocument> {
  if (db.products.length > 0) return db;
  const [{ products }, { plans }, { releases }, { faqs }, { announcements }] = await Promise.all([
    import('../../content/products'),
    import('../../content/plans'),
    import('../../content/changelog'),
    import('../../content/faq'),
    import('../../content/announcements'),
  ]);
  db.products = products;
  db.plans = plans;
  db.releases = releases;
  db.faqs = faqs;
  db.announcements = announcements;
  return db;
}
