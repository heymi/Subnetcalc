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
} from '../assets/js/vlsm-render.js';
import { planVlsm } from '../lib/subnet.js';

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
      <p class="footer-note">Every calculation runs in your browser. Nothing you type is sent anywhere.</p>
    </div>
    <div>
      <h2>Tools</h2>
      <ul>
        <li><a href="/">Subnet calculator</a></li>
        <li><a href="/vlsm/">VLSM planner</a></li>
        <li><a href="/cidr/">CIDR aggregation &amp; overlaps</a></li>
        <li><a href="/ipv6/">IPv6 tools</a></li>
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
      <h2>Engine</h2>
      <ul>
        <li><a href="/lib/subnet.js">lib/subnet.js</a> · MIT</li>
        <li><a href="/lib/data/special-purpose.json">IANA special-purpose data</a></li>
      </ul>
    </div>
  </div>
</footer>`;

function prefixTableHtml() {
  const rows = prefixTable(4)
    .map(
      (r) =>
        `<tr id="p${r.prefix}"><td>/${r.prefix}</td><td>${r.netmask}</td><td>${r.wildcard}</td><td class="num">${group(r.totalAddresses)}</td><td class="num">${group(r.usableHosts)}</td></tr>`,
    )
    .join('\n');
  return `<div class="table-wrap"><table class="data">
<thead><tr><th scope="col">Prefix</th><th scope="col">Netmask</th><th scope="col">Wildcard</th><th scope="col" class="num">Addresses</th><th scope="col" class="num">Usable hosts</th></tr></thead>
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
  return `<div class="table-wrap"><table class="data">
<thead><tr><th scope="col">Prefix</th><th scope="col" class="num">/64 subnets</th><th scope="col" class="num">Addresses</th><th scope="col">Common use</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
}

const defaultInfo = () => analyze(DEFAULT_Q).info;
const defaultPlan = () => planVlsm(DEFAULT_PARENT, DEFAULT_REQUESTS).plan;
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PRERENDER = {
  'calc-notices': () => renderNotices(defaultInfo()),
  'calc-results': () => renderResults(defaultInfo()),
  'calc-binary': () => renderBinary(defaultInfo()),
  'calc-steps': () => renderSteps(defaultInfo()),
  'vlsm-summary': () => renderSummary(defaultPlan()),
  'vlsm-map': () => renderMap(defaultPlan()),
  'vlsm-table': () => renderTable(defaultPlan()),
  'vlsm-free': () => renderFree(defaultPlan()),
  'vlsm-tree': () => renderTree(defaultPlan()),
  'vlsm-export': () => escHtml(EXPORTS[0].fn(defaultPlan()).trimEnd()),
  'prefix-table-v4': prefixTableHtml,
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

function sitemap(files) {
  const urls = files
    .filter((f) => !f.endsWith('404.html'))
    .map((f) => `  <url><loc>${ORIGIN}${urlPath(f)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = pages();
  const stale = [];
  const outputs = files.map((f) => [f, build(f)]);
  outputs.push([join(ROOT, 'sitemap.xml'), sitemap(files)]);
  for (const [f, content] of outputs) {
    let old = '';
    try {
      old = readFileSync(f, 'utf8');
    } catch {}
    if (old !== content) {
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
