import type { Announcement } from '../lib/types';

/** Site announcements — shown on the home page and account overview. */
export const announcements: Announcement[] = [
  {
    id: 'ann-beta-1',
    title: 'Zenith V2 beta is open',
    body: 'Zenith V2 is in closed beta. Join the community Discord to request beta access and follow development.',
    date: '2026-07-15',
    published: true,
    priority: 'high',
  },
  {
    id: 'ann-042',
    title: 'Beta 0.4.2 released',
    body: 'HUD overhaul, theme engine options, and stability fixes are live in the changelog for entitled users.',
    date: '2026-08-10',
    published: true,
    priority: 'normal',
  },
  {
    id: 'ann-store',
    title: 'Store payments are being set up',
    body: 'The store architecture is in place but payment processing is not connected yet. Purchases cannot be completed until a provider is integrated.',
    date: '2026-08-01',
    published: true,
    priority: 'normal',
  },
];
