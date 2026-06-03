// Generates public/apple-touch-icon.png (no external deps) so iOS has a PNG
// home-screen icon. A rounded blue tile with a white rounded "card".
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 180; // apple-touch-icon size
const BG = [37, 99, 235]; // #2563eb
const CARD = [255, 255, 255];

function rounded(x, y, w, h, r, px, py) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

const raw = Buffer.alloc(S * (1 + S * 3));
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 3)] = 0; // filter byte
  for (let x = 0; x < S; x++) {
    const inCard = rounded(38, 46, 104, 88, 14, x, y);
    const [r, g, b] = inCard ? CARD : BG;
    const o = y * (1 + S * 3) + 1 + x * 3;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit, color type 2 (RGB)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('../public/apple-touch-icon.png', import.meta.url), png);
console.log(`Wrote apple-touch-icon.png (${png.length} bytes)`);
