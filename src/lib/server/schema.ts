import type { DbDocument } from '../types';

/** A fresh, empty database document. */
export function emptyDb(): DbDocument {
  return {
    schemaVersion: 1,
    seededAt: null,
    content: {
      heroTitle: 'A premium Minecraft client.',
      heroSubtitle:
        'Performance-focused, deeply customizable, and built to feel effortless. Zenith is the client for players who care about every detail.',
      heroCtaPrimary: 'Get Zenith',
      heroCtaSecondary: 'Explore Features',
      discordUrl: '[DISCORD_LINK]',
      supportUrl: '[SUPPORT_LINK]',
      announcementBanner: 'Zenith V2 beta is open — join the community Discord for access.',
      announcementBannerActive: false,
    },
    users: [],
    sessions: [],
    purchases: [],
    subscriptions: [],
    activity: [],
    audit: [],
    products: [],
    plans: [],
    releases: [],
    faqs: [],
    announcements: [],
    tokens: [],
    counters: {},
  };
}
