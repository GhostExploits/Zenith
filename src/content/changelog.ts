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
    version: '0.4.2-beta',
    title: 'Beta 0.4.2',
    date: '2026-08-10',
    channel: 'beta',
    featured: true,
    published: true,
    summary: 'HUD overhaul, new theme engine options, and a round of stability fixes across movement and render modules.',
    sections: [
      {
        title: 'Added',
        items: [
          'Theme engine: custom accent colors and per-panel styling',
          'HUD: new target-info widgets with configurable layout anchors',
          'Profile sync: manual export/import of full config packs',
        ],
      },
      {
        title: 'Improved',
        items: [
          'Click GUI search now matches module descriptions, not just names',
          'Reduced input latency on the settings panel during gameplay',
          'Smoother name-tag distance scaling on high entity counts',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Fixed a crash when opening the HUD editor with certain theme presets',
          'Fixed velocity settings not applying after a server change',
          'Fixed ESP lines rendering incorrectly on 1.21.x',
        ],
      },
    ],
    minecraftVersions: ['1.8.9', '1.12.2', '1.16.5', '1.21.x'],
    platforms: ['Windows 10/11', 'macOS (Intel & Apple Silicon)', 'Linux'],
    asset: {
      filename: 'Zenith-V2-0.4.2-beta.jar',
      sizeBytes: 0, // placeholder — populated when real builds are published
      sha256: '[RELEASE_SHA256]',
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
    asset: {
      filename: 'Zenith-V2-0.4.1-beta.jar',
      sizeBytes: 0,
      sha256: '[RELEASE_SHA256]',
    },
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
    asset: {
      filename: 'Zenith-V2-0.4.0-beta.jar',
      sizeBytes: 0,
      sha256: '[RELEASE_SHA256]',
    },
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
    asset: {
      filename: 'Zenith-V2-0.3.0-beta.jar',
      sizeBytes: 0,
      sha256: '[RELEASE_SHA256]',
    },
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
