// Builds the extension for Chrome and Firefox from one source tree.
// Output: dist/chrome and dist/firefox, each a loadable unpacked extension.
import * as esbuild from 'esbuild';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const sharedDir = resolve(root, '../shared');
const tmp = resolve(root, 'dist/_js');

// OAuth Client ID baked into the build: GOOGLE_CLIENT_ID env, else the repo
// .env's VITE_GOOGLE_CLIENT_ID (shared with the PWA). Public-by-design, so safe.
function bakedClientId() {
  if (process.env.GOOGLE_CLIENT_ID) return process.env.GOOGLE_CLIENT_ID.trim();
  const envPath = resolve(root, '../.env');
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^\s*VITE_GOOGLE_CLIENT_ID\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  return '';
}
const CLIENT_ID = bakedClientId();
console.log(CLIENT_ID ? `Baking Client ID …${CLIENT_ID.slice(-12)}` : 'No Client ID baked (set it in the popup)');

rmSync(resolve(root, 'dist'), { recursive: true, force: true });

// 1) Bundle background + popup + the OAuth redirect content script.
await esbuild.build({
  entryPoints: {
    background: resolve(root, 'src/background.ts'),
    popup: resolve(root, 'src/popup.ts'),
    'oauth-content': resolve(root, 'src/oauth-content.ts'),
  },
  bundle: true,
  format: 'iife',
  target: ['chrome109', 'firefox115'],
  outdir: tmp,
  alias: { '@shared': sharedDir },
  resolveExtensions: ['.ts', '.js'],
  define: { __CLIENT_ID__: JSON.stringify(CLIENT_ID) },
  logLevel: 'info',
});

// 2) Generate simple PNG icons (no deps): blue tile + white rounded card.
function genPng(size) {
  const BG = [37, 99, 235];
  const CARD = [255, 255, 255];
  const r = Math.round(size * 0.08);
  const cx = Math.round(size * 0.21);
  const cy = Math.round(size * 0.26);
  const cw = size - cx * 2;
  const ch = Math.round(size * 0.48);
  const rounded = (x, y, w, h, rad, px, py) => {
    if (px < x || py < y || px >= x + w || py >= y + h) return false;
    const qx = Math.min(Math.max(px, x + rad), x + w - rad);
    const qy = Math.min(Math.max(py, y + rad), y + h - rad);
    return (px - qx) ** 2 + (py - qy) ** 2 <= rad * rad;
  };
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0;
    for (let x = 0; x < size; x++) {
      const [cr, cg, cb] = rounded(cx, cy, cw, ch, r, x, y) ? CARD : BG;
      const o = y * (1 + size * 3) + 1 + x * 3;
      raw[o] = cr; raw[o + 1] = cg; raw[o + 2] = cb;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const icon48 = genPng(48);
const icon128 = genPng(128);

// 3) Compose per-browser manifests and assemble dist folders.
const base = JSON.parse(readFileSync(resolve(root, 'manifest.base.json'), 'utf8'));
const targets = {
  chrome: { ...base, background: { service_worker: 'background.js' } },
  firefox: {
    ...base,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'stanki@local',
        strict_min_version: '115.0',
        // Required by AMO: Stanki stores only to the user's own Google Drive and
        // sends looked-up words to public dictionaries; no developer-side collection.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = resolve(root, 'dist', name);
  mkdirSync(out, { recursive: true });
  copyFileSync(resolve(tmp, 'background.js'), resolve(out, 'background.js'));
  copyFileSync(resolve(tmp, 'popup.js'), resolve(out, 'popup.js'));
  copyFileSync(resolve(tmp, 'oauth-content.js'), resolve(out, 'oauth-content.js'));
  copyFileSync(resolve(root, 'popup.html'), resolve(out, 'popup.html'));
  writeFileSync(resolve(out, 'icon-48.png'), icon48);
  writeFileSync(resolve(out, 'icon-128.png'), icon128);
  writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`built dist/${name}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log('Extension build complete.');
