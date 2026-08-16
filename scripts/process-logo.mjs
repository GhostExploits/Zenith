/**
 * Zenith logo processing — pure Node, zero dependencies.
 *
 * Derives the asset variants the site needs from the single source file
 * `public/logo/source/zenith-logo-on-black.png` (the original, unmodified):
 *
 *   public/favicon.png                   letterboxed square (64x64)
 *   public/favicon-192.png               letterboxed square (192x192)
 *   public/apple-touch-icon.png          letterboxed square (180x180)
 *   public/og-image.png                  social share card (1200x630, black bg)
 *
 * The source file is never modified or redrawn.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public/logo/source/zenith-logo-on-black.png');
const OUT = join(root, 'public');

// ---------------------------------------------------------------------------
// Minimal PNG codec (8-bit, non-interlaced; color types 0,2,3,4,6)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`unsupported color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      line[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const ci = x * channels;
      const oi = (y * width + x) * 4;
      if (colorType === 0) {
        out[oi] = out[oi + 1] = out[oi + 2] = line[ci];
        out[oi + 3] = 255;
      } else if (colorType === 2) {
        out[oi] = line[ci]; out[oi + 1] = line[ci + 1]; out[oi + 2] = line[ci + 2];
        out[oi + 3] = 255;
      } else if (colorType === 3) {
        // palette — need PLTE; collect during scan
        throw new Error('palette PNG not supported in this build');
      } else if (colorType === 4) {
        out[oi] = out[oi + 1] = out[oi + 2] = line[ci];
        out[oi + 3] = line[ci + 1];
      } else {
        out[oi] = line[ci]; out[oi + 1] = line[ci + 1]; out[oi + 2] = line[ci + 2];
        out[oi + 3] = line[ci + 3];
      }
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

function encodePng(width, height, pixels) {
  const channels = 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    pixels.copy(raw, p, y * stride, (y + 1) * stride);
    p += stride;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function samplePixel(pixels, w, h, x, y) {
  const i = (y * w + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

/** Bilinear resize. */
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xRatio = sw / dw, yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const oi = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v =
          src[(y0 * sw + x0) * 4 + c] * (1 - fx) * (1 - fy) +
          src[(y0 * sw + x1) * 4 + c] * fx * (1 - fy) +
          src[(y1 * sw + x0) * 4 + c] * (1 - fx) * fy +
          src[(y1 * sw + x1) * 4 + c] * fx * fy;
        out[oi + c] = Math.round(v);
      }
    }
  }
  return out;
}

/** Fit `src` (aspect preserved) into a `dst` x `dst` square on a black background. */
function letterbox(src, sw, sh, dst) {
  const scale = Math.min(dst / sw, dst / sh);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const scaled = resize(src, sw, sh, w, h);
  const out = Buffer.alloc(dst * dst * 4);
  const ox = Math.floor((dst - w) / 2), oy = Math.floor((dst - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4, di = ((oy + y) * dst + ox + x) * 4;
      out[di] = scaled[si]; out[di + 1] = scaled[si + 1];
      out[di + 2] = scaled[si + 2]; out[di + 3] = scaled[si + 3];
    }
  }
  return out;
}

/** Remove near-black background pixels (soft threshold), returning RGBA. */
function removeBlackBg(src, sw, sh) {
  const out = Buffer.from(src);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const min = Math.min(r, g, b);
    const THRESHOLD = 28;
    if (min < THRESHOLD) {
      out[i + 3] = Math.round((min / THRESHOLD) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const src = decodePng(readFileSync(SRC));
const { width: sw, height: sh, pixels: sp } = src;
console.log(`source: ${sw}x${sh} PNG`);

// Sanity: expect a black background (corner pixel should be near-black).
const [cr, cg, cb] = samplePixel(sp, sw, sh, 4, 4);
console.log(`corner pixel: rgb(${cr},${cg},${cb})`);
if (Math.max(cr, cg, cb) > 40) {
  console.warn('WARN: source logo does not appear to have a black background — transparency variant may be wrong.');
}

// 1. Favicons — letterboxed squares of the original (keeps halo intact)
// (The transparent logo variants are produced by scripts/optimize-logo.mjs.)
for (const size of [64, 192, 180]) {
  const sq = letterbox(sp, sw, sh, size);
  const name = size === 180 ? 'apple-touch-icon.png' : size === 192 ? 'favicon-192.png' : 'favicon.png';
  writeFileSync(join(OUT, name), encodePng(size, size, sq));
  console.log(`wrote ${name} (${size}x${size})`);
}

// 2. OG image — 1200x630 black card with the logo fitted to ~92% width
{
  const W = 1200, H = 630;
  const scale = Math.min((W * 0.92) / sw, (H * 0.55) / sh);
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const scaled = resize(sp, sw, sh, w, h);
  const out = Buffer.alloc(W * H * 4);
  const ox = Math.floor((W - w) / 2), oy = Math.floor((H - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4, di = ((oy + y) * W + ox + x) * 4;
      out[di] = scaled[si]; out[di + 1] = scaled[si + 1];
      out[di + 2] = scaled[si + 2]; out[di + 3] = 255;
    }
  }
  writeFileSync(join(OUT, 'og-image.png'), encodePng(W, H, out));
  console.log('wrote og-image.png (1200x630)');
}

console.log('done.');
