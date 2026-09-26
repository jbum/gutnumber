// Draws the extension icon (blue rounded square, three white bars) as PNGs. No dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };

function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.2;
  const inRounded = (x, y) => { const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
  const bars = [[0.22, 0.55], [0.43, 0.35], [0.64, 0.2]]; // [left, top] as fractions; width 0.16, bottom 0.8
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const fx = (x + 0.5) / size, fy = (y + 0.5) / size;
    if (!inRounded(x + 0.5, y + 0.5)) continue;
    const bar = bars.some(([l, t]) => fx >= l && fx <= l + 0.16 && fy >= t && fy <= 0.8);
    const [R, G, B] = bar ? [255, 255, 255] : [47, 111, 223];
    px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = 255;
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 48, 128]) writeFileSync(`packages/extension/static/icon${s}.png`, icon(s));
// Same art as the web app's favicon.
writeFileSync('packages/client/public/favicon.png', icon(64));
console.log('icons written');
