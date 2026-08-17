import type { Release } from '../lib/types';

/**
 * Release / changelog data.
 *
 * This static list ships with the site as the initial catalog; the admin panel
 * manages releases in the database from here on. Keep release notes neutral
 * and verifiable.
 */
export const releases: Release[] = [
  {
    id: 'rel-z2-042',
    productId: 'zenith-v2',
    version: '4.21',
    title: 'Zenith V2 4.21',
    date: '2026-08-16',
    channel: 'stable',
    featured: true,
    published: true,
    summary:
      'Zenith V2 4.21: the current release build with the license-activated loader, one-PC device binding, and the full module suite.',
    sections: [
      {
        title: 'License & activation',
        items: [
          'Licenses activate through the loader and bind to one PC — the same key cannot be used on a second machine',
          'Every license is verified server-side and signed with the Zenith authority key',
          'Subscriptions renew automatically and keep the client active while paid',
        ],
      },
      {
        title: 'Client',
        items: [
          'Full module suite: combat, movement, render, player, world and utility categories',
          'Modern Click GUI with search, profiles and theme engine',
          'Native loader injection for reduced startup latency',
        ],
      },
      {
        title: 'Supported',
        items: ['Windows 10/11 with the bundled loader', 'Minecraft 1.8.9, 1.12.2, 1.16.5, 1.21.x'],
      },
    ],
    minecraftVersions: ['1.8.9', '1.12.2', '1.16.5', '1.21.x'],
    platforms: ['Windows 10/11'],
    asset: {
      filename: 'Zenith-V2-4.21.zip',
      sizeBytes: 48952076,
      sha256: 'd0fcd52b1c4f1f1e854f3c24670b337cc990e9d5b078a11228b6240f46368097',
    },
    requiresEntitlement: true,
  },
  {
    id: 'rel-z2-041',
    productId: 'zenith-v2',
    version: '0.4.1-beta',
    title: 'Beta 0.4.1',
    date: '2026-07-28',
    channel: 'beta',
    featured: false,
    published: true,
    summary: 'Movement tuning, keybind manager improvements, and targeted fixes for 1.16.5.',
    sections: [
      {
        title: 'Added',
        items: ['Keybind manager: mouse-button and modifier support', 'Movement: per-gamemode sprint profiles'],
      },
      {
        title: 'Improved',
        items: ['Reduced settings write amplification on profile save', 'Faster module list rendering in the Click GUI'],
      },
      {
        title: 'Fixed',
        items: ['Fixed sneak edge-stop not triggering on slabs', 'Fixed timer module desync on 1.16.5 after respawn'],
      },
    ],
    minecraftVersions: ['1.8.9', '1.12.2', '1.16.5', '1.21.x'],
    platforms: ['Windows 10/11', 'macOS (Intel & Apple Silicon)', 'Linux'],
    requiresEntitlement: true,
  },
  {
    id: 'rel-z2-040',
    productId: 'zenith-v2',
    version: '0.4.0-beta',
    title: 'Beta 0.4.0',
    date: '2026-07-12',
    channel: 'beta',
    featured: false,
    published: true,
    summary: 'New scaffolding module, streamer mode, and a big performance pass.',
    sections: [
      {
        title: 'Added',
        items: ['Scaffold module with tower mode and rotation handling', 'Streamer mode to hide sensitive account details', 'Performance modes: one-click rendering profiles'],
      },
      {
        title: 'Improved',
        items: ['Rebuilt the module loader for faster startup', 'Cleaner font rendering across all supported versions'],
      },
      {
        title: 'Fixed',
        items: ['Fixed a memory leak in the ESP renderer', 'Fixed cloud profile sync conflicts on first login'],
      },
    ],
    minecraftVersions: ['1.8.9', '1.12.2', '1.16.5', '1.21.x'],
    platforms: ['Windows 10/11', 'macOS (Intel & Apple Silicon)', 'Linux'],
    requiresEntitlement: true,
  },
  {
    id: 'rel-z2-030',
    productId: 'zenith-v2',
    version: '0.3.0-beta',
    title: 'Beta 0.3.0',
    date: '2026-06-20',
    channel: 'beta',
    featured: false,
    published: true,
    summary: 'First public beta: combat suite, movement suite, and the new settings panel.',
    sections: [
      {
        title: 'Added',
        items: ['Full combat module suite (aim, clicker, reach, velocity)', 'Movement suite with sprint, speed, and timer', 'New settings panel with live search and profiles'],
      },
      {
        title: 'Improved',
        items: ['Reduced client startup time', 'Lowered default render load for mid-range GPUs'],
      },
    ],
    minecraftVersions: ['1.8.9', '1.12.2', '1.16.5'],
    platforms: ['Windows 10/11', 'macOS (Intel & Apple Silicon)', 'Linux'],
    requiresEntitlement: true,
  },
];

export function getRelease(id: string): Release | undefined {
  return releases.find((r) => r.id === id);
}

export function releasesForProduct(productId: string): Release[] {
  return releases
    .filter((r) => r.productId === productId && r.published)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
