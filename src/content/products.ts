import type { Product } from '../lib/types';

/**
 * Product catalog — the public source of truth for product pages.
 *
 * The admin panel manages a copy of this catalog in the database; the static
 * content below is the foundation shipped with the site. Product pages render
 * from the union of both (see src/lib/server/catalog.ts).
 *
 * NOTE: keep claims verifiable. No "undetectable", no bypass language.
 */
export const products: Product[] = [
  {
    id: 'zenith-v2',
    name: 'Zenith V2',
    slug: 'zenith-v2',
    tagline: 'Precision tools. Competitive advantage.',
    shortDescription:
      'A performance-focused Minecraft client with a modular, deeply customizable feature set — rebuilt from the ground up.',
    longDescription:
      'Zenith V2 is a complete rebuild of the Zenith client. Every module was redesigned around three principles: precise control, clean interface, and predictable performance. Configure everything from a modern settings panel, save profiles per server or gamemode, and keep your game running smoothly with an architecture built for current Minecraft versions.',
    icon: '/logo/zenith-logo-600.webp',
    screenshots: [
      '/media/screenshot-main.svg',
      '/media/screenshot-combat.svg',
      '/media/screenshot-movement.svg',
      '/media/screenshot-render.svg',
      '/media/screenshot-interface.svg',
    ],
    features: [
      { id: 'f-combat-1', name: 'Aim assist', description: 'Subtle, configurable aim smoothing with per-server profiles and sensitivity scaling.', icon: 'crosshair', category: 'Combat' },
      { id: 'f-combat-2', name: 'AutoClicker', description: 'Adjustable click patterns, randomized delays, and hold-to-click binding with full range control.', icon: 'mouse', category: 'Combat' },
      { id: 'f-combat-3', name: 'Reach', description: 'Adjustable reach modifier with visual range feedback and per-server configuration.', icon: 'ruler', category: 'Combat' },
      { id: 'f-combat-4', name: 'Velocity', description: 'Fine-grained horizontal and vertical velocity control with reduction sliders.', icon: 'wind', category: 'Combat' },
      { id: 'f-move-1', name: 'Sprint & sneak', description: 'Toggle and hold behaviors for sprint and sneak with smooth transitions.', icon: 'footprints', category: 'Movement' },
      { id: 'f-move-2', name: 'Speed', description: 'Configurable movement speed modifier with adjustable strafe behavior.', icon: 'gauge', category: 'Movement' },
      { id: 'f-move-3', name: 'Timer', description: 'Adjustable game tick rate with a clean, stable implementation.', icon: 'clock', category: 'Movement' },
      { id: 'f-render-1', name: 'ESP', description: 'Entity visualization with configurable box, name, health, and tracer modes.', icon: 'eye', category: 'Render' },
      { id: 'f-render-2', name: 'Click GUI', description: 'A fluid, searchable module panel with drag-and-drop customization and profile switching.', icon: 'grid', category: 'Render' },
      { id: 'f-render-3', name: 'HUD', description: 'Modular on-screen information — target info, coordinates, FPS, and more.', icon: 'layout', category: 'Render' },
      { id: 'f-player-1', name: 'Sprint', description: 'Automatic sprint with configurable edge stops and sneak detection.', icon: 'person-running', category: 'Player' },
      { id: 'f-world-1', name: 'Name tags', description: 'Enhanced name tag rendering with distance scaling and team colors.', icon: 'tag', category: 'World' },
      { id: 'f-world-2', name: 'Item physics', description: 'Customizable item drop rotation and swing animations.', icon: 'cube', category: 'World' },
      { id: 'f-util-1', name: 'Anti-cheat checks', description: 'Client-side checks with configurable alerts for your own gameplay consistency.', icon: 'shield', category: 'Utility' },
      { id: 'f-util-2', name: 'Scaffold', description: 'Smooth block placement with configurable timing, tower mode, and rotation handling.', icon: 'bricks', category: 'Utility' },
      { id: 'f-visual-1', name: 'Custom models', description: 'Replace in-game models with configurable visuals for a cleaner look.', icon: 'palette', category: 'Visual' },
      { id: 'f-ui-1', name: 'Streamer mode', description: 'Hide sensitive account information and anonymize identifiable details.', icon: 'user-shield', category: 'Interface' },
      { id: 'f-ui-2', name: 'Theme engine', description: 'Custom accent colors, panel themes, and per-module styling.', icon: 'droplet', category: 'Interface' },
      { id: 'f-perf-1', name: 'Performance modes', description: 'One-click profiles that reduce rendering load while keeping visuals sharp.', icon: 'zap', category: 'Performance' },
      { id: 'f-qol-1', name: 'Profile sync', description: 'Cloud-synced config profiles that follow you across installs.', icon: 'cloud', category: 'Quality of Life' },
      { id: 'f-qol-2', name: 'Keybind manager', description: 'Conflict-free keybindings with mouse-button and modifier support.', icon: 'keyboard', category: 'Quality of Life' },
    ],
    minecraftVersions: ['1.8.9', '1.12.2', '1.16.5', '1.21.x'],
    platforms: ['Windows 10/11', 'macOS (Intel & Apple Silicon)', 'Linux'],
    channel: 'beta',
    currentVersion: '4.21',
    availability: 'beta',
    featured: true,
    purchaseType: 'both',
    planIds: ['zenith-bronze', 'zenith-silver', 'zenith-diamond', 'zenith-gold'],
    status: 'beta',
    downloadEnabled: true,
    specs: [
      { label: 'Java', value: 'Java 8+ (17+ recommended)' },
      { label: 'Launcher', value: 'MultiMC, Prism, official, or any modern launcher' },
      { label: 'RAM', value: '4 GB recommended' },
      { label: 'OS', value: 'Windows, macOS, Linux' },
    ],
    faqIds: ['faq-install-1', 'faq-versions-1', 'faq-billing-1', 'faq-download-1'],
  },
];

/** Future products slot in here and appear automatically once published. */
// export const upcomingProducts: Product[] = [];

export function getProductBySlug(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}
