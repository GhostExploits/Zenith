import type { Plan } from '../lib/types';

/**
 * Official Zenith tiers.
 *
 * These seed the database catalog; after the first seed, the admin panel
 * (Plans) is the source of truth and edits here stop mattering. Prices are
 * shown in minor units (cents).
 *
 * Every tier unlocks the SAME client — all modules, all features. The tiers
 * differ in how long your license stays valid and how fast you get support
 * and early builds. All licenses are bound to ONE PC (device-bound), so a
 * single license cannot be shared across machines.
 */
export const plans: Plan[] = [
  {
    id: 'zenith-bronze',
    productId: 'zenith-v2',
    name: 'Bronze',
    priceCents: 1499,
    currency: 'USD',
    interval: 'month',
    description: 'Full Zenith, month to month. Every module and every update while your subscription is active.',
    features: [
      'All Zenith V2 modules',
      'All updates while subscribed',
      'Cloud profile sync',
      'Community support',
      '1 PC per license',
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
    description: 'A full year of Zenith at a lower monthly rate — the best value for a serious grind.',
    features: [
      'Everything in Bronze',
      'A full year — 2 months free vs. monthly',
      'Priority support',
      'Early access to new modules',
      '1 PC per license',
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
    description: 'The premium monthly tier — everything, plus the earliest access to new builds.',
    features: [
      'Everything in Silver',
      'Earliest access to beta builds',
      'Pre-release module previews',
      'Priority support, faster replies',
      '1 PC per license',
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
    description: 'Pay once, own it forever. A permanent license that never expires.',
    features: [
      'Permanent license — never expires',
      'All updates forever',
      'Priority support',
      'Early access to beta builds',
      '1 PC per license',
    ],
    active: true,
    highlighted: false,
    licenseMode: 'permanent',
    tier: 'gold',
  },
];

/**
 * Metal identity per tier — the tiers are literally metals, so each card
 * carries a single quiet mark in its metal's color (hairline + chip). Kept
 * out of the Plan type on purpose: DB-seeded plans only need the `tier`
 * string, and unknown tiers fall back to the neutral accent.
 */
export const tierMeta: Record<string, { color: string }> = {
  bronze: { color: '#d08c55' },
  silver: { color: '#c7ccd9' },
  gold: { color: '#e9b64a' },
  diamond: { color: '#8fc9ec' },
};

export function tierColor(tier: string | undefined): string {
  return (tier && tierMeta[tier]?.color) || '#e9e9ee';
}

export function plansForProduct(productId: string): Plan[] {
  return plans.filter((p) => p.productId === productId && p.active);
}

export function getPlan(planId: string): Plan | undefined {
  return plans.find((p) => p.id === planId);
}
