#!/usr/bin/env node
// Pre-deploy checks for every HTML page. No dependencies; exits 1 on any error.
//
//   node scripts/check-site.mjs
//
// Errors: missing/duplicate SEO tags, wrong canonical, not exactly one <h1>, banned wording,
// broken internal links or #anchors, invalid JSON-LD, FAQ schema that does not match the page,
// duplicate ids, unlabeled buttons, http:// links, stale partials (scripts/build.mjs --check).
// Warnings: titles over 65 characters, descriptions outside 70–170 characters.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pages, urlPath } from './build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://subnetcalc.dev';
const BANNED = [/\bbest\b/i, /\bmost accurate\b/i, /\bultimate\b/i, /\bnumber one\b/i, /\b#1\b/];

const errors = [];
const warnings = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);
const warn = (page, msg) => warnings.push(`${page}: ${msg}`);

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const all = (re, s) => [...s.matchAll(re)];

// map a URL path to the file that would serve it
function fileFor(path) {
  const clean = decodeURIComponent(path.split(/[?#]/)[0]);
  const p = join(ROOT, clean);
  if (clean.endsWith('/')) return existsSync(join(p, 'index.html')) ? join(p, 'index.html') : null;
  if (existsSync(p) && statSync(p).isFile()) return p;
  if (existsSync(p + '.html')) return p + '.html';
  return null;
}

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, 'utf8');
    idCache.set(file, new Set(all(/\sid="([^"]+)"/g, html).map((m) => m[1])));
  }
  return idCache.get(file);
}

// 1. partials and pre-rendered blocks are current
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs'), '--check'], { stdio: 'pipe' });
} catch (e) {
  err('build', String(e.stderr || e.stdout).trim());
}

const files = pages();
const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');

for (const file of files) {
  const path = urlPath(file);
  const name = path;
  const html = readFileSync(file, 'utf8');
  const is404 = file.endsWith('404.html');
  const head = html.slice(0, html.indexOf('</head>'));
  const body = html.slice(html.indexOf('<body'));

  if (!/^<!doctype html>/i.test(html)) err(name, 'missing <!doctype html>');
  if (!/<html lang="en">/.test(html)) err(name, 'missing <html lang="en">');
  if (!/<meta charset="utf-8">/.test(head)) err(name, 'missing charset');
  if (!/<meta name="viewport"/.test(head)) err(name, 'missing viewport');

  const titles = all(/<title>([\s\S]*?)<\/title>/g, head);
  if (titles.length !== 1) err(name, `expected one <title>, found ${titles.length}`);
  else if (titles[0][1].length > 65) warn(name, `title is ${titles[0][1].length} chars: ${titles[0][1]}`);

  if (!is404) {
    const desc = head.match(/<meta name="description" content="([^"]*)">/);
    if (!desc) err(name, 'missing meta description');
    else if (desc[1].length < 70 || desc[1].length > 170) warn(name, `description is ${desc[1].length} chars`);
    const canon = head.match(/<link rel="canonical" href="([^"]+)">/);
    if (!canon) err(name, 'missing canonical');
    else if (canon[1] !== ORIGIN + path) err(name, `canonical ${canon[1]} != ${ORIGIN + path}`);
    const og = head.match(/<meta property="og:url" content="([^"]+)">/);
    if (!og || og[1] !== ORIGIN + path) err(name, 'og:url missing or different from canonical');
    for (const p of ['og:title', 'og:description', 'og:image']) {
      if (!head.includes(`property="${p}"`)) err(name, `missing ${p}`);
    }
    if (!sitemap.includes(`<loc>${ORIGIN + path}</loc>`)) err(name, 'not in sitemap.xml');
  }

  const h1 = all(/<h1[\s>]/g, body);
  if (h1.length !== 1) err(name, `expected one <h1>, found ${h1.length}`);

  // banned wording in visible text and meta content
  const visible = text(body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''));
  const metas = all(/<meta [^>]*content="([^"]*)"/g, head).map((m) => m[1]).join(' ') + ' ' + (titles[0]?.[1] || '');
  for (const re of BANNED) {
    const m = (visible + ' ' + metas).match(re);
    if (m) err(name, `banned wording "${m[0]}"`);
  }

  // duplicate ids
  const ids = all(/\sid="([^"]+)"/g, html).map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) err(name, `duplicate ids: ${[...new Set(dup)].join(', ')}`);

  // links
  for (const [, href] of all(/\shref="([^"]+)"/g, html)) {
    if (href.startsWith('http://')) err(name, `insecure link ${href}`);
    if (href.startsWith('#')) {
      if (href.length > 1 && !idsOf(file).has(decodeURIComponent(href.slice(1)))) err(name, `missing anchor ${href}`);
      continue;
    }
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const target = fileFor(href);
    if (!target) {
      err(name, `broken link ${href}`);
      continue;
    }
    const hash = href.split('#')[1];
    if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) err(name, `missing anchor ${href}`);
  }
  for (const [, src] of all(/\ssrc="(\/[^"]+)"/g, html)) {
    if (!fileFor(src)) err(name, `missing resource ${src}`);
  }

  // buttons need a name
  for (const [tag, inner] of all(/<button\b([^>]*)>([\s\S]*?)<\/button>/g, html).map((m) => [m[1], m[2]])) {
    if (!/aria-label="[^"]+"/.test(tag) && !text(inner) && !/data-theme-toggle/.test(tag)) err(name, `button without a name: <button${tag}>`);
  }
  for (const [, tag] of all(/<img\b([^>]*)>/g, html)) {
    if (!/\salt="/.test(tag)) err(name, `img without alt: ${tag}`);
  }

  // JSON-LD parses; FAQPage matches the visible questions
  for (const [, json] of all(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, head)) {
    let data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      err(name, `invalid JSON-LD: ${e.message}`);
      continue;
    }
    const nodes = data['@graph'] || [data];
    for (const n of nodes) {
      if (n['@type'] !== 'FAQPage') continue;
      const schemaQs = n.mainEntity.map((q) => q.name);
      const pageQs = all(/<details>\s*<summary>([\s\S]*?)<\/summary>/g, body).map((m) => text(m[1]));
      for (const q of schemaQs) if (!pageQs.includes(q)) err(name, `FAQ schema question not on page: ${q}`);
      for (const q of n.mainEntity) {
        const a = q.acceptedAnswer?.text || '';
        if (a.length < 40) err(name, `FAQ answer too short: ${q.name}`);
      }
    }
  }
}

// sitemap entries must exist
for (const [, loc] of all(/<loc>([^<]+)<\/loc>/g, sitemap)) {
  if (!fileFor(loc.replace(ORIGIN, ''))) err('sitemap.xml', `entry has no page: ${loc}`);
}
for (const f of ['robots.txt', 'favicon.svg', 'og.png', '404.html', '_headers']) {
  if (!existsSync(join(ROOT, f))) err('site', `missing ${f}`);
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`check-site: ${files.length} pages, ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
