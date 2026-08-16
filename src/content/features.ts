import type { FeatureCategory } from '../lib/types';

/** Feature categories used to organize the Features page and admin editor. */
export const featureCategories: FeatureCategory[] = [
  { id: 'Combat', name: 'Combat', description: 'Precise, configurable combat modules with per-server profiles.', icon: 'crosshair' },
  { id: 'Movement', name: 'Movement', description: 'Tight, responsive movement controls with adjustable behavior.', icon: 'footprints' },
  { id: 'Render', name: 'Render', description: 'Clean visuals and information overlays without clutter.', icon: 'eye' },
  { id: 'Player', name: 'Player', description: 'Everyday quality-of-life for how you move and play.', icon: 'person-running' },
  { id: 'World', name: 'World', description: 'Tasteful enhancements to how the world looks and behaves.', icon: 'globe' },
  { id: 'Utility', name: 'Utility', description: 'Practical tools that keep your gameplay consistent.', icon: 'wrench' },
  { id: 'Visual', name: 'Visual', description: 'Customization of models, colors, and interface themes.', icon: 'palette' },
  { id: 'Interface', name: 'Interface', description: 'A modular HUD and settings experience designed for speed.', icon: 'layout' },
  { id: 'Performance', name: 'Performance', description: 'Profiles that keep the client smooth on modest hardware.', icon: 'gauge' },
  { id: 'Quality of Life', name: 'Quality of Life', description: 'Small, thoughtful conveniences that add up.', icon: 'spark' },
];
