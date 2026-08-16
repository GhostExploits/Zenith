import type { MediaItem } from '../lib/types';

/**
 * Media gallery.
 *
 * All items currently point at clearly-marked local SVG placeholders
 * (public/media/*.svg). Replace `src` with real screenshots when available —
 * keep the same aspect ratio (16:9) for a consistent gallery.
 */
export const mediaItems: MediaItem[] = [
  { id: 'm-main', src: '/media/screenshot-main.svg', alt: 'Zenith V2 main interface placeholder screenshot', kind: 'screenshot', productId: 'zenith-v2', caption: 'Main interface' },
  { id: 'm-combat', src: '/media/screenshot-combat.svg', alt: 'Zenith V2 combat modules placeholder screenshot', kind: 'screenshot', productId: 'zenith-v2', caption: 'Combat modules' },
  { id: 'm-movement', src: '/media/screenshot-movement.svg', alt: 'Zenith V2 movement modules placeholder screenshot', kind: 'screenshot', productId: 'zenith-v2', caption: 'Movement modules' },
  { id: 'm-render', src: '/media/screenshot-render.svg', alt: 'Zenith V2 render modules placeholder screenshot', kind: 'screenshot', productId: 'zenith-v2', caption: 'Render modules' },
  { id: 'm-interface', src: '/media/screenshot-interface.svg', alt: 'Zenith V2 settings interface placeholder screenshot', kind: 'screenshot', productId: 'zenith-v2', caption: 'Settings interface' },
];

export function mediaForProduct(productId?: string): MediaItem[] {
  if (!productId) return mediaItems;
  return mediaItems.filter((m) => !m.productId || m.productId === productId);
}
