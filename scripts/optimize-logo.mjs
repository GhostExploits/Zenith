/**
 * Optimized logo variants via sharp (build-time dev tool, not shipped).
 * Reads the source logo (white on pure black) and emits:
 *   public/logo/zenith-logo.webp / .png   (transparent bg, 1400px + 600px)
 *   public/logo/zenith-logo-600.webp      (600px transparent)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public/logo/source/zenith-logo-on-black.png');
const OUT = join(root, 'public/logo');

// Remove near-black background (soft threshold), preserving the white glow.
async function transparent(buffer, width) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.from(data);
  const TH = 26;
  for (let i = 0; i < px.length; i += 4) {
    const min = Math.min(px[i], px[i + 1], px[i + 2]);
    if (min < TH) px[i + 3] = Math.round((min / TH) * 255);
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(width, undefined, { fit: 'inside', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

const srcBuf = readFileSync(SRC);

for (const width of [1400, 600]) {
  const name = width === 1400 ? 'zenith-logo' : 'zenith-logo-600';
  const png = await transparent(srcBuf, width);
  writeFileSync(join(OUT, `${name}.png`), png);
  const webp = await sharp(png).webp({ quality: 92, effort: 6 }).toBuffer();
  writeFileSync(join(OUT, `${name}.webp`), webp);
  console.log(`wrote ${name}.png (${(png.length / 1024).toFixed(0)}KB) and .webp (${(webp.length / 1024).toFixed(0)}KB)`);
}
