import type { Plan } from '../lib/types';

/**
 * Official Zenith tiers.
 *
 * These seed the database catalog; after the first seed, the admin panel
 * (Plans) is the source of truth and edits here stop mattering. Prices are
 * shown in minor units (cents).
 */
export const plans: Plan[] = [
  {
    id: 'zenith-bronze',
    productId: 'zenith-v2',
    name: 'Bronze',
    priceCents: 1499,
    currency: 'USD',
    interval: 'month',
    description: 'Full access to Zenith while your subscription is active.',
    features: [
      'All Zenith V2 modules',
      'All updates while subscribed',
      'Cloud profile sync',
      'Community support',
    ],
    active: true,
    highlighted: false,
    licenseMode: 'subscription-period',
    tier: 'bronze',
  },
  {
    id: 'zenith-silver',
    productId: 'zenith-v2',
    name: 'Silver',
    priceCents: 5999,
    currency: 'USD',
    interval: 'year',
    description: 'A full year of Zenith at a reduced rate — two months free vs. monthly.',
    features: [
      'Everything in Bronze',
      '2 months free vs. monthly',
      'Priority support',
      'Early access to new modules',
    ],
    active: true,
    highlighted: true,
    licenseMode: 'subscription-period',
    tier: 'silver',
  },
  {
    id: 'zenith-diamond',
    productId: 'zenith-v2',
    name: 'Diamond',
    priceCents: 2499,
    currency: 'USD',
    interval: 'month',
    description: 'The premium monthly tier for players who want every edge immediately.',
    features: [
      'Everything in Silver',
      'Priority support, faster replies',
      'Early access to beta builds',
      'Pre-release module previews',
    ],
    active: true,
    highlighted: false,
    licenseMode: 'subscription-period',
    tier: 'diamond',
  },
  {
    id: 'zenith-gold',
    productId: 'zenith-v2',
    name: 'Gold',
    priceCents: 19999,
    currency: 'USD',
    interval: 'once',
    description: 'One-time purchase. A permanent license that never expires.',
    features: [
      'Permanent license — never expires',
      'All updates forever',
      'Priority support',
      'Early access to beta builds',
    ],
    active: true,
    highlighted: false,
    licenseMode: 'permanent',
    tier: 'gold',
  },
];

export function plansForProduct(productId: string): Plan[] {
  return plans.filter((p) => p.productId === productId && p.active);
}

export function getPlan(planId: string): Plan | undefined {
  return plans.find((p) => p.id === planId);
}
