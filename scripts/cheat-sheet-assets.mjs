// One-page CIDR cheat sheet PDF and a ~1200px PNG. No dependencies:
// PDF uses the built-in Helvetica font; the PNG is drawn from scripts/data/sheet-font.json.
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefixTable } from '../lib/subnet.js';
import { group } from '../assets/js/ui.js';

const FONT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'data/sheet-font.json'), 'utf8'));
const GLYPHS = Object.fromEntries(
  Object.entries(FONT.glyphs).map(([ch, b64]) => [ch, Buffer.from(b64, 'base64')]),
);

export function per24(prefix) {
  if (prefix <= 24) return group(1n << BigInt(24 - prefix));
  return `1/${1 << (prefix - 24)}`;
}

export function sheetRows() {
  return prefixTable(4).map((r) => ({
    prefix: `/${r.prefix}`,
    mask: r.netmask,
    wild: r.wildcard,
    total: group(r.totalAddresses),
    usable: group(r.usableHosts),
    per24: per24(r.prefix),
  }));
}

const COLS = [
  { key: 'prefix', title: 'Prefix', w: 110 },
  { key: 'mask', title: 'Subnet mask', w: 230 },
  { key: 'wild', title: 'Wildcard', w: 230 },
  { key: 'total', title: 'Addresses', w: 210, right: true },
  { key: 'usable', title: 'Usable hosts', w: 210, right: true },
  { key: 'per24', title: '/24s', w: 150, right: true },
];

const PAD = 28;
const TITLE = 54;
const ROW = 26;
export const SHEET_W = PAD * 2 + COLS.reduce((n, c) => n + c.w, 0);
export const SHEET_H = PAD + TITLE + ROW * (1 + 33) + PAD;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    rgb.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fill(rgb, w, x, y, rw, rh, color) {
  const [cr, cg, cb] = color;
  for (let yy = y; yy < y + rh; yy++) {
    if (yy < 0 || yy >= SHEET_H) continue;
    const row = yy * w * 3;
    for (let xx = x; xx < x + rw; xx++) {
      if (xx < 0 || xx >= w) continue;
      const i = row + xx * 3;
      rgb[i] = cr;
      rgb[i + 1] = cg;
      rgb[i + 2] = cb;
    }
  }
}

function textWidth(text) {
  return text.length * FONT.w;
}

function drawText(rgb, w, x, y, text, ink) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] || GLYPHS['?'];
    if (g) {
      for (let gy = 0; gy < FONT.h; gy++) {
        const py = y + gy;
        if (py < 0 || py >= SHEET_H) continue;
        for (let gx = 0; gx < FONT.w; gx++) {
          const px = cx + gx;
          if (px < 0 || px >= w) continue;
          const v = g[gy * FONT.w + gx];
          if (v > 210) continue;
          const a = (210 - v) / 210;
          const i = (py * w + px) * 3;
          rgb[i] = Math.round(rgb[i] * (1 - a) + ink[0] * a);
          rgb[i + 1] = Math.round(rgb[i + 1] * (1 - a) + ink[1] * a);
          rgb[i + 2] = Math.round(rgb[i + 2] * (1 - a) + ink[2] * a);
        }
      }
    }
    cx += FONT.w;
  }
}

export function sheetPng() {
  const w = SHEET_W;
  const h = SHEET_H;
  const rgb = Buffer.alloc(w * h * 3, 255);
  const ink = [22, 28, 36];
  const muted = [70, 84, 98];
  fill(rgb, w, 0, 0, w, h, [255, 255, 255]);
  drawText(rgb, w, PAD, PAD, 'CIDR cheat sheet', ink);
  drawText(rgb, w, PAD, PAD + 22, 'Subnet mask, wildcard, addresses and usable hosts, /0 to /32', muted);
  const headY = PAD + TITLE;
  fill(rgb, w, PAD, headY, w - PAD * 2, ROW, [27, 58, 75]);
  let x = PAD;
  for (const col of COLS) {
    const tx = col.right ? x + col.w - 10 - textWidth(col.title) : x + 8;
    drawText(rgb, w, tx, headY + 2, col.title, [255, 255, 255]);
    x += col.w;
  }
  const rows = sheetRows();
  rows.forEach((row, i) => {
    const y = headY + ROW * (i + 1);
    if (i % 2 === 0) fill(rgb, w, PAD, y, w - PAD * 2, ROW, [244, 247, 251]);
    let cx = PAD;
    for (const col of COLS) {
      const value = row[col.key];
      const tx = col.right ? cx + col.w - 10 - textWidth(value) : cx + 8;
      drawText(rgb, w, tx, y + 2, value, ink);
      cx += col.w;
    }
  });
  return png(w, h, rgb);
}

function pdfEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Single A4 page. Helvetica, six columns, /0 through /32. */
export function sheetPdf() {
  const pageW = 595.28;
  const pageH = 841.89;
  const left = 32;
  const cols = [32, 78, 188, 308, 430, 510];
  const lines = [];
  lines.push('BT');
  lines.push('/F2 14 Tf');
  lines.push(`1 0 0 1 ${left} 806 Tm (${pdfEscape('CIDR cheat sheet')}) Tj`);
  lines.push('/F1 8 Tf');
  lines.push(`1 0 0 1 ${left} 790 Tm (${pdfEscape('Subnet mask, wildcard, total addresses and usable hosts for /0 to /32.')}) Tj`);
  lines.push('/F2 8 Tf');
  const heads = ['Prefix', 'Subnet mask', 'Wildcard', 'Addresses', 'Usable hosts', '/24s'];
  heads.forEach((h, i) => lines.push(`1 0 0 1 ${cols[i]} 770 Tm (${pdfEscape(h)}) Tj`));
  lines.push('/F1 8 Tf');
  const rows = sheetRows();
  rows.forEach((row, i) => {
    const y = 756 - i * 16.15;
    const vals = [row.prefix, row.mask, row.wild, row.total, row.usable, row.per24];
    vals.forEach((v, c) => lines.push(`1 0 0 1 ${cols[c]} ${y.toFixed(2)} Tm (${pdfEscape(v)}) Tj`));
  });
  lines.push('ET');
  const stream = lines.join('\n');
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
  );
  add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n`;
  out += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pages = out.split('/Type /Page /Parent').length - 1;
  if (pages !== 1) throw new Error(`cheat sheet PDF has ${pages} pages`);
  return Buffer.from(out);
}

export function sheetFigureHtml() {
  return `<img class="sheet-fig" src="/learn/cidr-cheat-sheet/cidr-cheat-sheet.png" width="${SHEET_W}" height="${SHEET_H}" alt="CIDR cheat sheet: subnet mask table from /0 to /32">`;
}
