/**
 * Entitlements.
 *
 * Access to a product is derived server-side from the account's purchases
 * (permanent) and active subscriptions — never from frontend state.
 *
 * Downloads specifically require an ACTIVE SUBSCRIPTION: `hasSubscribedAccess`
 * and `subscribedProductIds` are the gates the download API and downloads
 * page use, so a lapsed subscription immediately loses download access.
 */
import type { DbDocument, Subscription, User } from '../types';

export function activeSubscription(db: DbDocument, userId: string, productId: string): Subscription | null {
  return (
    db.subscriptions.find(
      (s) =>
        s.userId === userId &&
        s.productId === productId &&
        s.status === 'active' &&
        new Date(s.currentPeriodEnd).getTime() > Date.now(),
    ) ?? null
  );
}

export function hasPermanentPurchase(db: DbDocument, userId: string, productId: string): boolean {
  return db.purchases.some((p) => p.userId === userId && p.productId === productId && p.status === 'paid');
}

/** True when the user holds any valid entitlement for the product. */
export function hasEntitlement(db: DbDocument, user: User, productId: string): boolean {
  if (user.suspended) return false;
  return hasPermanentPurchase(db, user.id, productId) || activeSubscription(db, user.id, productId) !== null;
}

/** True when the user has an ACTIVE subscription granting access to the product. */
export function hasSubscribedAccess(db: DbDocument, user: User, productId: string): boolean {
  if (user.suspended) return false;
  return activeSubscription(db, user.id, productId) !== null;
}

/** Product ids the user can download right now (active subscriptions only). */
export function subscribedProductIds(db: DbDocument, user: User): string[] {
  if (user.suspended) return [];
  const ids = new Set<string>();
  for (const s of db.subscriptions) {
    if (
      s.userId === user.id &&
      s.status === 'active' &&
      new Date(s.currentPeriodEnd).getTime() > Date.now()
    ) {
      ids.add(s.productId);
    }
  }
  return [...ids];
}

/** Owned products (id list) for a user. */
export function ownedProductIds(db: DbDocument, user: User): string[] {
  const ids = new Set<string>();
  for (const p of db.purchases) if (p.userId === user.id && p.status === 'paid') ids.add(p.productId);
  for (const s of db.subscriptions) {
    if (
      s.userId === user.id &&
      s.status === 'active' &&
      new Date(s.currentPeriodEnd).getTime() > Date.now()
    ) {
      ids.add(s.productId);
    }
  }
  return [...ids];
}
