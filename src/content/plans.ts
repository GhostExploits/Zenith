import type { Plan } from '../lib/types';

/**
 * Pricing plans.
 *
 * PRICES ARE PLACEHOLDERS until the owner finalizes pricing. They are defined
 * in exactly one place so they can be adjusted from the admin panel later
 * without touching components. No payment provider is connected yet — the
 * checkout flow intentionally stops at a "payment not configured" state.
 */
export const plans: Plan[] = [
  {
    id: 'zenith-v2-monthly',
    productId: 'zenith-v2',
    name: 'Monthly',
    priceCents: 1295,
    currency: 'USD',
    interval: 'month',
    description: 'Flexible month-to-month access to Zenith V2.',
    features: ['Full Zenith V2 feature set', 'All updates while subscribed', 'Cloud profile sync', 'Community support'],
    active: true,
    highlighted: false,
  },
  {
    id: 'zenith-v2-yearly',
    productId: 'zenith-v2',
    name: 'Yearly',
    priceCents: 9995,
    currency: 'USD',
    interval: 'year',
    description: 'A full year of Zenith V2 at a reduced rate.',
    features: ['Everything in Monthly', '2 months free vs. monthly', 'Priority support', 'Early access to new modules'],
    active: true,
    highlighted: true,
  },
  {
    id: 'zenith-v2-lifetime',
    productId: 'zenith-v2',
    name: 'Lifetime',
    priceCents: 24995,
    currency: 'USD',
    interval: 'once',
    description: 'One-time purchase. Permanent entitlement to Zenith V2.',
    features: ['Permanent Zenith V2 entitlement', 'All updates forever', 'Cloud profile sync', 'Priority support'],
    active: true,
    highlighted: false,
  },
];

export function plansForProduct(productId: string): Plan[] {
  return plans.filter((p) => p.productId === productId && p.active);
}

export function getPlan(planId: string): Plan | undefined {
  return plans.find((p) => p.id === planId);
}
