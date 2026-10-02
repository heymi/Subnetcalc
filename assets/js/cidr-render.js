// Pure renderers for the CIDR tools page (also used to pre-render the defaults).
import { parseCidr, networkOf, aggregate, supernet, findOverlaps, rangeToCidrs, formatCidr, SubnetError } from '../../lib/subnet.js';
import { esc, group, count } from './ui.js';

export const DEFAULT_NETS = `10.0.0.0/24
10.0.1.0/24
10.0.2.0/24
10.0.3.0/24
10.0.2.128/25
10.0.5.0 255.255.255.0
10.0.8.0/24`;
export const DEFAULT_RANGE = ['192.168.1.10', '192.168.1.20'];

const size = (c) => 1n << BigInt((c.version === 4 ? 32 : 128) - c.prefix);
const copyBtn = (text, label = 'copy') => `<button type="button" class="copy" data-copy="${esc(text)}">${label}</button>`;

function parseList(text) {
  const items = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const raw of line.split(/[,;]/)) {
      const s = raw.replace(/#.*/, '').trim();
      if (!s) continue;
      try {
        items.push({ line: i + 1, text: s, cidr: networkOf(parseCidr(s)) });
      } catch (e) {
        if (!(e instanceof SubnetError)) throw e;
        errors.push({ line: i + 1, text: s, message: e.message });
      }
    }
  });
  return { items, errors };
}

/** @returns {{ errors: string, agg: string, sup: string, ovl: string }} */
export function renderNets(text) {
  const { items, errors } = parseList(text);
  const out = {
    errors: errors
      .map((e) => `<p class="notice is-error"><strong>Line ${e.line}:</strong> <code>${esc(e.text)}</code> ${esc(e.message)}.</p>`)
      .join(''),
    agg: '',
    sup: '',
    ovl: '',
  };
  if (!items.length) return out;
  const byVersion = [4, 6].map((v) => items.filter((x) => x.cidr.version === v)).filter((l) => l.length);
  for (const list of byVersion) {
    const cidrs = list.map((x) => x.cidr);
    const merged = aggregate(cidrs);
    out.agg += `<div class="row"><span class="k">${list.length} in → ${merged.length} out</span>${copyBtn(merged.map(formatCidr).join('\n'))}</div><ul>${merged
      .map((c) => `<li>${esc(formatCidr(c))}</li>`)
      .join('')}</ul>`;
    const s = supernet(cidrs);
    const covered = merged.reduce((a, c) => a + size(c), 0n);
    const extra = size(s) - covered;
    out.sup += `<div class="row"><b>${esc(formatCidr(s))}</b>${copyBtn(formatCidr(s))}</div><div class="row"><span class="k">covers</span><span>${count(size(s))} addresses</span></div><div class="row"><span class="k">not in your list</span><span${extra > 0n ? ' class="warn"' : ''}>${count(extra)}</span></div>`;
  }
  const pairs = findOverlaps(items.map((x) => x.cidr));
  if (!pairs.length) {
    out.ovl = `<span class="k">No overlaps among ${items.length} network${items.length === 1 ? '' : 's'}.</span>`;
  } else {
    const word = { equal: 'is the same as', contains: 'contains', contained: 'is inside' };
    out.ovl = `<ul>${pairs
      .map((p) => {
        const a = items[p.i];
        const b = items[p.j];
        return `<li><span class="warn">line ${a.line}</span> ${esc(formatCidr(a.cidr))} ${word[p.relation]} <span class="warn">line ${b.line}</span> ${esc(formatCidr(b.cidr))}</li>`;
      })
      .join('')}</ul>`;
  }
  return out;
}

export function renderRange(a, b) {
  if (!a || !b) return '';
  try {
    const list = rangeToCidrs(a, b);
    const total = list.reduce((s, c) => s + size(c), 0n);
    return `<div class="row"><span class="k">${list.length} block${list.length === 1 ? '' : 's'} · ${group(total)} addresses</span>${copyBtn(list.map(formatCidr).join('\n'))}</div><ul>${list
      .map((c) => `<li><a href="/?q=${esc(formatCidr(c))}">${esc(formatCidr(c))}</a></li>`)
      .join('')}</ul>`;
  } catch (e) {
    if (!(e instanceof SubnetError)) throw e;
    return e.code === 'INCOMPLETE' ? '' : `<span class="warn">${esc(e.message)}.</span>`;
  }
}
