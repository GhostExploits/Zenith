/**
 * Catalog access used by server-rendered pages.
 *
 * Database-first: if the store is configured (dev JSON store now; D1 later),
 * admin-managed rows win. If the store is unavailable (production until a
 * backend is wired), pages fall back to the static content shipped with the
 * site. Public pages therefore always render.
 */
import type { Announcement, FaqEntry, Plan, Product, Release } from '../types';
import { products as staticProducts } from '../../content/products';
import { plans as staticPlans } from '../../content/plans';
import { releases as staticReleases } from '../../content/changelog';
import { faqs as staticFaqs } from '../../content/faq';
import { announcements as staticAnnouncements } from '../../content/announcements';
import { getStore } from './store';

async function dbSnapshot<T>(pick: (store: import('./store').Store) => T | null): Promise<T | null> {
  try {
    const store = await getStore();
    return pick(store) ?? null;
  } catch {
    return null;
  }
}

export async function getProducts(): Promise<Product[]> {
  const db = await dbSnapshot<Product[]>((s) => (s.db().products.length ? s.db().products : null));
  return db ?? staticProducts;
}

export async function getProduct(slug: string): Promise<Product | undefined> {
  return (await getProducts()).find((p) => p.slug === slug);
}

export async function getProductById(id: string): Promise<Product | undefined> {
  return (await getProducts()).find((p) => p.id === id);
}

export async function getPlans(): Promise<Plan[]> {
  const db = await dbSnapshot<Plan[]>((s) => (s.db().plans.length ? s.db().plans : null));
  return db ?? staticPlans;
}

export async function getPlansForProduct(productId: string): Promise<Plan[]> {
  return (await getPlans()).filter((p) => p.productId === productId && p.active);
}

export async function getPlan(planId: string): Promise<Plan | undefined> {
  return (await getPlans()).find((p) => p.id === planId);
}

export async function getPublishedReleases(): Promise<Release[]> {
  const db = await dbSnapshot<Release[]>((s) => (s.db().releases.length ? s.db().releases : null));
  const list = db ?? staticReleases;
  return list
    .filter((r) => r.published && (!r.scheduledFor || new Date(r.scheduledFor).getTime() <= Date.now()))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getRelease(id: string): Promise<Release | undefined> {
  return (await getPublishedReleases()).find((r) => r.id === id);
}

export async function getReleasesForProduct(productId: string): Promise<Release[]> {
  return (await getPublishedReleases()).filter((r) => r.productId === productId);
}

export async function getPublishedFaqs(): Promise<FaqEntry[]> {
  const db = await dbSnapshot<FaqEntry[]>((s) => (s.db().faqs.length ? s.db().faqs : null));
  const list = db ?? staticFaqs;
  return list.filter((f) => f.published);
}

export async function getPublishedAnnouncements(): Promise<Announcement[]> {
  const db = await dbSnapshot<Announcement[]>((s) => (s.db().announcements.length ? s.db().announcements : null));
  const list = db ?? staticAnnouncements;
  return list.filter((a) => a.published).sort((a, b) => (a.date < b.date ? 1 : -1));
}
