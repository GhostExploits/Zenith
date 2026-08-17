/**
 * Database seed.
 *
 * Runs exactly once, when the store has no data (fresh local JSON database
 * file, or an empty D1 database on Cloudflare). It mirrors the static catalog
 * content into the database so admin-editable data starts populated, and
 * creates the initial owner account from ADMIN_EMAIL / ADMIN_PASSWORD.
 *
 * Dev mode additionally seeds demo users/subscriptions and placeholder
 * release files so the account + download flows can be exercised locally.
 * Production (`production: true`) creates only the real owner account and the
 * catalog — never fake users or files.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbDocument, Purchase, User } from '../types';
import { hashPassword } from './auth';

const DEV_ADMIN_EMAIL = 'admin@zenith.local';
const DEV_ADMIN_PASSWORD = 'zenith-dev-admin';

/** Lazy path — never evaluated at module load (dev-only store). */
function storageDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../data/storage');
}

export interface SeedOptions {
  /** True when seeding a production database: no demo users, no placeholder files. */
  production?: boolean;
}

export async function seedIfEmpty(db: DbDocument, opts: SeedOptions = {}): Promise<DbDocument> {
  await seedCatalogIntoDb(db);
  if (!opts.production) seedReleaseAssets(db);

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

  db.seededAt = now;
  db.users.push(admin);

  // Everything below is development-only demo data. Never seed it into a
  // production database.
  if (opts.production) return db;

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
  db.users.push(...demoUsers);

  // Demo subscription so account pages render meaningfully (dev only).
  const periodEnd = new Date(Date.now() + 26 * 24 * 60 * 60 * 1000).toISOString();
  db.subscriptions.push({
    id: 'sub-demo-1',
    userId: 'user-demo-0',
    productId: 'zenith-v2',
    planId: 'zenith-bronze',
    status: 'active',
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    provider: 'dev-seed',
    createdAt: now,
  });

  // Demo license (signed with the dev ephemeral key) so the account dashboard
  // and authority endpoints can be exercised without a real payment.
  const demoPlan = db.plans.find((p) => p.id === 'zenith-bronze');
  if (demoPlan) {
    const { buildLicenseForPurchase } = await import('./licenses');
    const demoUser = db.users.find((u) => u.id === 'user-demo-0')!;
    const purchase: Purchase = {
      id: 'purchase-demo-1',
      userId: demoUser.id,
      productId: 'zenith-v2',
      planId: demoPlan.id,
      amountCents: demoPlan.priceCents ?? 0,
      currency: demoPlan.currency,
      status: 'paid',
      provider: 'dev-seed',
      providerRef: 'dev-seed-1',
      createdAt: now,
      paidAt: now,
    };
    db.purchases.push(purchase);
    const subscription = db.subscriptions.find((s) => s.id === 'sub-demo-1');
    const license = await buildLicenseForPurchase(db, demoUser, demoPlan, purchase, subscription);
    db.licenses.push(license);
    purchase.licenseId = license.id;
  }

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
      const target = join(dir, filename);
      // Never overwrite a file that is already there (real builds placed in
      // data/storage or uploaded via the admin panel survive reseeds).
      if (existsSync(target)) continue;
      writeFileSync(
        target,
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
