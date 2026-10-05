// One-page CIDR cheat sheet PDF and a ~1200px PNG. No dependencies:
// PDF uses the built-in Helvetica font; the PNG is drawn from scripts/data/sheet-font.json.
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefixTable, requiredPrefix } from '../lib/subnet.js';
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

/** /25–/30 last-octet magic numbers. Starts are abbreviated once a row has more than eight. */
export function magicSheetRows() {
  return prefixTable(4)
    .filter((r) => r.prefix >= 25 && r.prefix <= 30)
    .map((r) => {
      const last = Number(r.netmask.split('.')[3]);
      const block = 256 - last;
      const starts = [];
      for (let i = 0; i < 256; i += block) starts.push(i);
      const list = starts.length > 8 ? `${starts.slice(0, 4).join(', ')}, … ${starts.at(-1)}` : starts.join(', ');
      return { prefix: r.prefix, last, block, starts: list, startsAscii: list.replace('…', '...') };
    });
}

export function magicOctetHtml() {
  const rows = magicSheetRows()
    .map(
      (r) =>
        `<tr><td><a href="/?q=10.0.0.0/${r.prefix}">/${r.prefix}</a></td><td class="num">${r.last}</td><td class="num">${r.block}</td><td>${r.starts}</td></tr>`,
    )
    .join('\n');
  return `<div class="table-wrap" tabindex="0"><table class="data">
<thead><tr><th scope="col">Prefix</th><th scope="col" class="num">Last mask octet</th><th scope="col" class="num">Block size</th><th scope="col">Subnet starts</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

const HOSTS_NEEDED = [2, 6, 14, 30, 62, 126, 254, 510];

/** Smallest prefix that still leaves `hosts` usable, one row per common host count. */
export function hostsSheetRows() {
  const table = prefixTable(4);
  return HOSTS_NEEDED.map((hosts) => {
    const prefix = requiredPrefix(hosts);
    const row = table[prefix];
    return { hosts, prefix, mask: row.netmask, usable: group(row.usableHosts) };
  });
}

export function hostsPrefixHtml() {
  const rows = hostsSheetRows()
    .map(
      (r) =>
        `<tr><td class="num">${r.hosts}</td><td><a href="/?q=10.0.0.0/${r.prefix}">/${r.prefix}</a></td><td>${r.mask}</td><td class="num">${r.usable}</td></tr>`,
    )
    .join('\n');
  return `<div class="table-wrap" tabindex="0"><table class="data">
<thead><tr><th scope="col" class="num">Hosts needed</th><th scope="col">Prefix</th><th scope="col">Subnet mask</th><th scope="col" class="num">Usable hosts</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
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
  drawText(rgb, w, PAD, PAD, 'Subnet cheat sheet', ink);
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

/** Single A4 page: the /0–/32 table, the /25–/30 magic numbers and the host-count lookup. */
export function sheetPdf() {
  const pageW = 595.28;
  const pageH = 841.89;
  const left = 32;
  const cols = [32, 78, 188, 308, 430, 510];
  const lines = [];
  lines.push('BT');
  lines.push('/F2 13 Tf');
  lines.push(`1 0 0 1 ${left} 812 Tm (${pdfEscape('Subnet cheat sheet')}) Tj`);
  lines.push('/F1 7.5 Tf');
  lines.push(`1 0 0 1 ${left} 798 Tm (${pdfEscape('Subnet mask, wildcard, total addresses and usable hosts for /0 to /32.')}) Tj`);
  lines.push('/F2 7.5 Tf');
  const heads = ['Prefix', 'Subnet mask', 'Wildcard', 'Addresses', 'Usable hosts', '/24s'];
  heads.forEach((h, i) => lines.push(`1 0 0 1 ${cols[i]} 784 Tm (${pdfEscape(h)}) Tj`));
  lines.push('/F1 7.5 Tf');
  const rows = sheetRows();
  rows.forEach((row, i) => {
    const y = 772 - i * 15.15;
    const vals = [row.prefix, row.mask, row.wild, row.total, row.usable, row.per24];
    vals.forEach((v, c) => lines.push(`1 0 0 1 ${cols[c]} ${y.toFixed(2)} Tm (${pdfEscape(v)}) Tj`));
  });
  const magicTop = 772 - 32 * 15.15 - 22;
  lines.push('/F2 9 Tf');
  lines.push(`1 0 0 1 ${left} ${magicTop.toFixed(2)} Tm (${pdfEscape('Magic number, /25 to /30')}) Tj`);
  lines.push('/F2 7.5 Tf');
  const mHeadY = magicTop - 14;
  const mCols = [32, 90, 170, 250];
  ['Prefix', 'Last octet', 'Block size', 'Subnet starts'].forEach((h, i) =>
    lines.push(`1 0 0 1 ${mCols[i]} ${mHeadY.toFixed(2)} Tm (${pdfEscape(h)}) Tj`),
  );
  lines.push('/F1 7.5 Tf');
  const magicLow = mHeadY - 12 - 5 * 11;
  magicSheetRows().forEach((row, i) => {
    const y = mHeadY - 12 - i * 11;
    const vals = [`/${row.prefix}`, String(row.last), String(row.block), row.startsAscii];
    vals.forEach((v, c) => lines.push(`1 0 0 1 ${mCols[c]} ${y.toFixed(2)} Tm (${pdfEscape(v)}) Tj`));
  });
  const hostsTop = magicLow - 20;
  lines.push('/F2 9 Tf');
  lines.push(`1 0 0 1 ${left} ${hostsTop.toFixed(2)} Tm (${pdfEscape('Hosts needed to prefix')}) Tj`);
  lines.push('/F2 7.5 Tf');
  const hHeadY = hostsTop - 14;
  ['Hosts needed', 'Prefix', 'Subnet mask', 'Usable hosts'].forEach((h, i) =>
    lines.push(`1 0 0 1 ${mCols[i]} ${hHeadY.toFixed(2)} Tm (${pdfEscape(h)}) Tj`),
  );
  lines.push('/F1 7.5 Tf');
  const hostsRows = hostsSheetRows();
  hostsRows.forEach((row, i) => {
    const y = hHeadY - 12 - i * 11;
    const vals = [group(row.hosts), `/${row.prefix}`, row.mask, row.usable];
    vals.forEach((v, c) => lines.push(`1 0 0 1 ${mCols[c]} ${y.toFixed(2)} Tm (${pdfEscape(v)}) Tj`));
  });
  lines.push('ET');
  const lowest = hHeadY - 12 - (hostsRows.length - 1) * 11;
  if (lowest < 28) throw new Error(`cheat sheet PDF content ends at y=${lowest}`);
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
  return `<img class="sheet-fig" src="/learn/cidr-cheat-sheet/cidr-cheat-sheet.png" width="${SHEET_W}" height="${SHEET_H}" alt="Subnet mask cheat sheet: CIDR table from /0 to /32">`;
}
