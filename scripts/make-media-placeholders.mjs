/**
 * Generates the clearly-marked local placeholder screenshots used by the
 * media gallery and product pages. Replace with real captures later —
 * keep 16:9 and the same filenames for a drop-in swap.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/media');
mkdirSync(dir, { recursive: true });

const shots = [
  { file: 'screenshot-main.svg', label: 'MAIN INTERFACE' },
  { file: 'screenshot-combat.svg', label: 'COMBAT MODULES' },
  { file: 'screenshot-movement.svg', label: 'MOVEMENT MODULES' },
  { file: 'screenshot-render.svg', label: 'RENDER MODULES' },
  { file: 'screenshot-interface.svg', label: 'SETTINGS INTERFACE' },
];

const grid = (x0, y0, x1, y1) => {
  let g = '';
  for (let x = x0; x <= x1; x += 40) g += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>`;
  for (let y = y0; y <= y1; y += 40) g += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>`;
  return g;
};

for (const s of shots) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#17171f"/>
      <stop offset="100%" stop-color="#0a0a0d"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#glow)"/>
  ${grid(0, 0, 1280, 720)}
  <rect x="20" y="20" width="1240" height="680" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
  <text x="640" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="700" letter-spacing="18" fill="#f2f2f5">ZENITH V2</text>
  <text x="640" y="392" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" letter-spacing="6" fill="#8a8a99">${s.label}</text>
  <text x="640" y="470" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" letter-spacing="3" fill="#5a5a66">PLACEHOLDER — REPLACE WITH REAL SCREENSHOT</text>
  <rect x="540" y="500" width="200" height="34" rx="4" fill="none" stroke="#e9b64a" stroke-opacity="0.5"/>
  <text x="640" y="522" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" letter-spacing="2" fill="#e9b64a">ZENITH</text>
</svg>`;
  writeFileSync(join(dir, s.file), svg);
  console.log(`wrote public/media/${s.file}`);
}
