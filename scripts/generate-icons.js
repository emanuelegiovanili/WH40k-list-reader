#!/usr/bin/env node
// Generates minimal PNG icons for the PWA manifest using only Node.js built-ins.
import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CRC32 ---
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(size) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  // compression/filter/interlace = 0

  // Raw RGBA pixel data with filter byte per row
  const raw = Buffer.alloc((size * 4 + 1) * size, 0);
  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.46;
  const innerR = size * 0.22;
  const spikeW = size * 0.08;

  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      // Draw a blood-drop / chaos star shape:
      // - dark background
      // - dark red outer ring
      // - black center circle
      // - 8 pointed spikes (chaos star)

      const idx = y * (size * 4 + 1) + 1 + x * 4;
      let r = 0x0f, g = 0x0f, b = 0x1a, a = 0xff;

      // 8-pointed spike: spike at every 45°
      const spikeAngle = ((angle % (Math.PI / 4)) + Math.PI / 4) % (Math.PI / 4);
      const spikeHalf = Math.PI / 4 / 2;
      const spikeSharpness = Math.abs(spikeAngle - spikeHalf) / spikeHalf;
      const spikeRadius = outerR * (0.55 + 0.45 * spikeSharpness);

      if (dist <= spikeRadius) {
        // Main body — dark red (#8B0000)
        r = 0x8b; g = 0x00; b = 0x00; a = 0xff;
      }
      if (dist <= innerR) {
        // Inner black/dark centre
        r = 0x22; g = 0x00; b = 0x00; a = 0xff;
      }

      // Thin border highlight
      const borderW = size * 0.025;
      if (dist > spikeRadius - borderW && dist <= spikeRadius) {
        r = Math.min(0xff, r + 0x50);
        g = Math.min(0xff, g + 0x10);
        b = Math.min(0xff, b + 0x10);
      }

      raw[idx] = r; raw[idx + 1] = g; raw[idx + 2] = b; raw[idx + 3] = a;
    }
  }

  const idat = chunk("IDAT", zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    idat,
    iend,
  ]);
}

const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const dest = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(dest, makePNG(size));
  console.log(`Generated ${dest}`);
}
