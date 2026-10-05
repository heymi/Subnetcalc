#!/usr/bin/env node
// Keeps the committed HTML in sync: shared <head> bits, header, footer, pre-rendered
// results and generated tables live between marker comments and are rewritten here.
// The site itself needs no build step; run this after editing a partial.
//
//   node scripts/build.mjs           rewrite files
//   node scripts/build.mjs --check   exit 1 if any file is out of date

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, prefixTable } from '../lib/subnet.js';
import { renderResults, renderBinary, renderSteps, renderNotices } from '../assets/js/calc-render.js';
import { group } from '../assets/js/ui.js';
import {
  DEFAULT_PARENT,
  DEFAULT_REQUESTS,
  EXPORTS,
  renderSummary,
  renderMap,
  renderTable,
  renderFree,
  renderTree,
  renderWorked,
} from '../assets/js/vlsm-render.js';
import { planVlsm } from '../lib/subnet.js';
import {
  DEFAULT_NETS,
  DEFAULT_RANGE,
  DEFAULT_OVERLAP_NETS,
  renderNets,
  renderRange,
  renderOverlapReport,
} from '../assets/js/cidr-render.js';
import { DEFAULTS as V6, renderAddress, renderSplit, renderEui } from '../assets/js/ipv6-render.js';
import { PLAN_DEFAULTS, renderPlan } from '../assets/js/ipv6-plan-render.js';
import { AWS_EXAMPLE, AZURE_HUB_EXAMPLE, AZURE_SPOKE_EXAMPLE, IPV6_EXAMPLE } from '../assets/js/examples.js';
import { sheetFigureHtml, sheetPdf, sheetPng } from './cheat-sheet-assets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://subnetcalc.dev';
const CHECK = process.argv.includes('--check');
export const DEFAULT_Q = '192.168.1.37/26';

const SKIP = new Set(['.git', 'node_modules', 'test', 'scripts', '.github', 'lib', 'assets']);

export function pages(dir = ROOT) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out.sort();
}

/** "/vlsm/" for vlsm/index.html */
export function urlPath(file) {
  const rel = relative(ROOT, file).split(sep).join('/');
  return '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '');
}

const NAV = [
  ['/', 'Subnet'],
  ['/vlsm/', 'VLSM'],
  ['/cidr/', 'CIDR'],
  ['/ipv6/', 'IPv6'],
  ['/learn/', 'Learn'],
];

const head = () => `<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
<meta name="theme-color" content="#f8f9fb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14171c" media="(prefers-color-scheme: dark)">
<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<script type="module" src="/assets/js/common.js"></script>`;

const header = (path) => {
  const current = path.startsWith('/learn/') ? '/learn/' : path;
  const items = NAV.map(
    ([href, label]) => `<li><a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a></li>`,
  ).join('\n      ');
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>SubnetCalc</a>
    <nav class="site-nav" aria-label="Main">
      <ul>
      ${items}
      </ul>
    </nav>
    <button type="button" class="btn btn-ghost icon-btn theme-toggle" data-theme-toggle aria-label="Switch theme"></button>
  </div>
</header>`;
};

const footer = () => `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <h2>SubnetCalc</h2>
      <p class="footer-note">Every calculation runs in your browser. Share links carry the inputs you put in them.</p>
    </div>
    <div>
      <h2>Tools</h2>
      <ul>
        <li><a href="/">Subnet calculator</a></li>
        <li><a href="/vlsm/">VLSM calculator</a></li>
        <li><a href="/cidr/">CIDR aggregation &amp; overlaps</a></li>
        <li><a href="/ip-range-to-cidr/">IP range to CIDR</a></li>
        <li><a href="/cidr-overlap-checker/">CIDR overlap checker</a></li>
        <li><a href="/ipv6/">IPv6 tools</a></li>
        <li><a href="/ipv6-subnet-plan/">IPv6 subnet plan</a></li>
      </ul>
    </div>
    <div>
      <h2>Learn</h2>
      <ul>
        <li><a href="/learn/subnetting/">Subnetting, step by step</a></li>
        <li><a href="/learn/cidr-cheat-sheet/">CIDR cheat sheet</a></li>
        <li><a href="/learn/ipv6-subnetting/">IPv6 subnetting</a></li>
      </ul>
    </div>
    <div>
      <h2>Examples</h2>
      <ul>
        <li><a href="/examples/aws-three-tier-vpc/">AWS three-tier VPC</a></li>
        <li><a href="/examples/azure-hub-spoke/">Azure hub-spoke</a></li>
        <li><a href="/examples/ipv6-48-56-64/">IPv6 /48 → /56 → /64</a></li>
      </ul>
    </div>
    <div>
      <h2>Engine</h2>
      <ul>
        <li><a href="/lib/subnet.js">lib/subnet.js</a> · MIT</li>
        <li><a href="/lib/data/special-purpose.json">IANA special-purpose data</a></li>
        <li><a href="/verification/">How results are verified</a></li>
        <li><a href="/privacy/">Privacy</a></li>
      </ul>
    </div>
  </div>
</footer>`;

function per24(prefix) {
  if (prefix <= 24) return group(1n << BigInt(24 - prefix));
  return `1/${1 << (prefix - 24)}`;
}

function prefixTableHtml() {
  const rows = prefixTable(4)
    .map(
      (r) =>
        `<tr id="p${r.prefix}"><td><a href="/?q=10.0.0.0/${r.prefix}">/${r.prefix}</a></td><td>${r.netmask}</td><td>${r.wildcard}</td><td class="num">${group(r.totalAddresses)}</td><td class="num">${group(r.usableHosts)}</td><td class="num">${per24(r.prefix)}</td></tr>`,
    )
    .join('\n');
  return `<div class="table-wrap sheet-table" tabindex="0"><table class="data">
<thead><tr><th scope="col">Prefix</th><th scope="col">Subnet mask</th><th scope="col">Wildcard mask</th><th scope="col" class="num">Total addresses</th><th scope="col" class="num">Usable hosts</th><th scope="col" class="num">/24s</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

function ipv6PrefixTableHtml() {
  const rows = [
    [32, 'Typical RIR allocation to an ISP'],
    [40, 'Large customer or regional block'],
    [44, 'Mid-size organisation'],
    [48, 'One site (RFC 6177 guidance)'],
    [52, 'Building or campus zone'],
    [56, 'Home or small office from an ISP'],
    [60, 'Smallest common delegation to a home'],
    [64, 'One LAN / VLAN (SLAAC needs /64)'],
    [112, 'Sometimes used to save space on infrastructure'],
    [126, 'Point-to-point (avoid; prefer /127)'],
    [127, 'Point-to-point link (RFC 6164)'],
    [128, 'Single address (loopback, anycast)'],
  ];
  const body = rows
    .map(([p, use]) => {
      const n64 = p <= 64 ? group(1n << BigInt(64 - p)) : '—';
      const addrs = 128 - p > 20 ? `2<sup>${128 - p}</sup>` : group(1n << BigInt(128 - p));
      return `<tr><td>/${p}</td><td class="num">${n64}</td><td class="num">${addrs}</td><td>${use}</td></tr>`;
    })
    .join('\n');
  return `<div class="table-wrap" tabindex="0"><table class="data">
<thead><tr><th scope="col">Prefix</th><th scope="col" class="num">/64 subnets</th><th scope="col" class="num">Addresses</th><th scope="col">Common use</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
}

function slash24Html() {
  const rows = [];
  for (let p = 24; p <= 32; p++) {
    const block = 2 ** (32 - p);
    const n = 2 ** (p - 24);
    const usable = p === 32 ? 1 : p === 31 ? 2 : block - 2;
    const starts = Array.from({ length: n }, (_, i) => i * block);
    const list = starts.length > 8 ? `${starts.slice(0, 4).join(', ')}, … ${starts.at(-1)}` : starts.join(', ');
    const mask = 256 - block;
    rows.push(
      `<tr><td>/${p}</td><td>${mask === 256 ? 0 : mask}</td><td class="num">${n}</td><td class="num">${block}</td><td class="num">${usable}</td><td>${list}</td></tr>`,
    );
  }
  return `<div class="table-wrap" tabindex="0"><table class="data">
<thead><tr><th scope="col">Prefix</th><th scope="col">Last mask octet</th><th scope="col" class="num">Subnets in a /24</th><th scope="col" class="num">Block size</th><th scope="col" class="num">Usable hosts</th><th scope="col">Networks start at .x</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></div>`;
}

function maskOctetHtml() {
  const rows = [];
  for (let bits = 0; bits <= 8; bits++) {
    const v = (0xff00 >> bits) & 0xff;
    rows.push(
      `<tr><td>${bits}</td><td>${v.toString(2).padStart(8, '0')}</td><td class="num">${v}</td><td class="num">${256 - v}</td><td class="num">${255 - v}</td></tr>`,
    );
  }
  return `<div class="table-wrap" tabindex="0"><table class="data">
<thead><tr><th scope="col">Ones</th><th scope="col">Binary</th><th scope="col" class="num">Mask octet</th><th scope="col" class="num">Block size</th><th scope="col" class="num">Wildcard octet</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></div>`;
}

const defaultInfo = () => analyze(DEFAULT_Q).info;
const defaultPlan = () => planVlsm(DEFAULT_PARENT, DEFAULT_REQUESTS).plan;
const casePlan = (example) => planVlsm(example.parent, example.requests, example.opts).plan;
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** IANA snapshot metadata and vector counts, read from the same files the engine and tests use. */
function verificationDataHtml() {
  const special = JSON.parse(readFileSync(join(ROOT, 'lib/data/special-purpose.json'), 'utf8'));
  const dir = join(ROOT, 'test/vectors');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const vectors = files.reduce((n, f) => {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return n + (Array.isArray(data) ? data.length : Object.values(data).flat().length);
  }, 0);
  const hash = (h) => `<code>${escHtml(h)}</code>`;
  return `<dl class="kv">
<div><dt>IANA IPv4 registry</dt><dd><span>${special.ipv4.length} special-purpose blocks</span></dd></div>
<div><dt>IANA IPv6 registry</dt><dd><span>${special.ipv6.length} special-purpose blocks, plus ${special.supplementary.length} supplementary well-known blocks</span></dd></div>
<div><dt>Retrieved</dt><dd><span>${special._retrieved} (UTC), downloaded directly from IANA</span></dd></div>
<div><dt>IPv4 source</dt><dd><span><a href="${special._sources.ipv4}">${special._sources.ipv4}</a></span></dd></div>
<div><dt>IPv6 source</dt><dd><span><a href="${special._sources.ipv6}">${special._sources.ipv6}</a></span></dd></div>
<div><dt>Shared test vectors</dt><dd><span>${vectors} vectors across ${files.length} files, each with at least two independent validators</span></dd></div>
</dl>
<details class="more"><summary>Retained SHA-256 hashes</summary><dl class="kv">
<div><dt>IPv4 CSV</dt><dd><span>${hash(special._sha256.ipv4)}</span></dd></div>
<div><dt>IPv6 CSV</dt><dd><span>${hash(special._sha256.ipv6)}</span></dd></div>
</dl></details>`;
}

const PRERENDER = {
  'calc-notices': () => renderNotices(defaultInfo()),
  'calc-results': () => renderResults(defaultInfo()),
  'calc-binary': () => renderBinary(defaultInfo()),
  'calc-steps': () => renderSteps(defaultInfo()),
  'vlsm-summary': () => renderSummary(defaultPlan()),
  'vlsm-map': () => renderMap(defaultPlan()),
  'vlsm-table': () => renderTable(defaultPlan()),
  'vlsm-free': () => renderFree(defaultPlan()),
  'vlsm-steps': () => renderWorked(defaultPlan()),
  'vlsm-tree': () => renderTree(defaultPlan()),
  'vlsm-export': () => escHtml(EXPORTS[0].fn(defaultPlan()).trimEnd()),
  'cidr-agg': () => renderNets(DEFAULT_NETS).agg,
  'cidr-sup': () => renderNets(DEFAULT_NETS).sup,
  'cidr-ovl': () => renderNets(DEFAULT_NETS).ovl,
  'cidr-range': () => renderRange(...DEFAULT_RANGE),
  'range-page-out': () => renderRange(...DEFAULT_RANGE),
  'overlap-page-out': () => renderOverlapReport(DEFAULT_OVERLAP_NETS).report,
  'verification-data': verificationDataHtml,
  'v6-addr': () => renderAddress(V6.addr),
  'v6-eui': () => renderEui(V6.mac, V6.eui),
  'v6-split': () => renderSplit(V6.split, V6.newPrefix),
  'ipv6-plan-out': () => renderPlan(PLAN_DEFAULTS.parent, PLAN_DEFAULTS.site, PLAN_DEFAULTS.lan).html,
  'aws-case-summary': () => renderSummary(casePlan(AWS_EXAMPLE)),
  'aws-case-table': () => renderTable(casePlan(AWS_EXAMPLE)),
  'aws-case-free': () => renderFree(casePlan(AWS_EXAMPLE)),
  'azure-hub-summary': () => renderSummary(casePlan(AZURE_HUB_EXAMPLE)),
  'azure-hub-table': () => renderTable(casePlan(AZURE_HUB_EXAMPLE)),
  'azure-hub-free': () => renderFree(casePlan(AZURE_HUB_EXAMPLE)),
  'azure-spoke-summary': () => renderSummary(casePlan(AZURE_SPOKE_EXAMPLE)),
  'azure-spoke-table': () => renderTable(casePlan(AZURE_SPOKE_EXAMPLE)),
  'azure-spoke-free': () => renderFree(casePlan(AZURE_SPOKE_EXAMPLE)),
  'ipv6-case-plan': () => renderPlan(IPV6_EXAMPLE.parent, IPV6_EXAMPLE.site, IPV6_EXAMPLE.lan).html,
  'prefix-table-v4': prefixTableHtml,
  'cidr-sheet-figure': sheetFigureHtml,
  'slash24-table': slash24Html,
  'mask-octet-table': maskOctetHtml,
  'prefix-table-v6': ipv6PrefixTableHtml,
};

function replaceBlock(html, name, content, file) {
  const re = new RegExp(`(<!-- @${name} -->)[\\s\\S]*?(<!-- /@${name.split(':')[0]} -->)`, 'g');
  let hit = false;
  const out = html.replace(re, (_, a, b) => {
    hit = true;
    return `${a}\n${content}\n${b}`;
  });
  return { out, hit };
}

function build(file) {
  const path = urlPath(file);
  let html = readFileSync(file, 'utf8');
  html = replaceBlock(html, 'head', head(), file).out;
  html = replaceBlock(html, 'header', header(path), file).out;
  html = replaceBlock(html, 'footer', footer(), file).out;
  for (const [name, fn] of Object.entries(PRERENDER)) {
    const r = replaceBlock(html, `prerender:${name}`, fn(), file);
    html = r.out;
  }
  return html;
}

function lastmod(file) {
  return statSync(file).mtime.toISOString().slice(0, 10);
}

function sitemap(entries) {
  const urls = entries
    .filter((u) => u.loc !== '/404.html')
    .sort((a, b) => (a.loc === '/' ? -1 : b.loc === '/' ? 1 : a.loc.localeCompare(b.loc)))
    .map((u) => `  <url><loc>${ORIGIN}${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = pages();
  const stale = [];
  const today = new Date().toISOString().slice(0, 10);
  const built = files.map((f) => {
    const content = build(f);
    let old = '';
    try {
      old = readFileSync(f, 'utf8');
    } catch {}
    return { f, content, changed: old !== content };
  });
  const outputs = built.map(({ f, content }) => [f, content]);
  outputs.push([
    join(ROOT, 'sitemap.xml'),
    sitemap(
      built.map(({ f, changed }) => ({
        loc: urlPath(f),
        lastmod: changed ? today : lastmod(f),
      })),
    ),
  ]);
  outputs.push([join(ROOT, 'learn/cidr-cheat-sheet/cidr-cheat-sheet.png'), sheetPng()]);
  outputs.push([join(ROOT, 'learn/cidr-cheat-sheet/cidr-cheat-sheet.pdf'), sheetPdf()]);
  for (const [f, content] of outputs) {
    const binary = Buffer.isBuffer(content);
    let old = binary ? null : '';
    try {
      old = readFileSync(f);
    } catch {}
    const same = binary ? old && old.equals(content) : old && old.toString('utf8') === content;
    if (!same) {
      stale.push(relative(ROOT, f));
      if (!CHECK) writeFileSync(f, content);
    }
  }
  if (CHECK && stale.length) {
    console.error(`Out of date (run node scripts/build.mjs):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(CHECK ? `build: ${files.length} pages up to date` : `build: ${stale.length} file(s) written`);
}
