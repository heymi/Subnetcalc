// Pure renderers for the CIDR tools page and the dedicated range/overlap pages.
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
export const DEFAULT_OVERLAP_NETS = `10.0.0.0/24
10.0.0.128/25
10.0.1.0/24`;

const size = (c) => 1n << BigInt((c.version === 4 ? 32 : 128) - c.prefix);
const copyBtn = (text, label = 'copy', disabled = false) =>
  disabled
    ? `<button type="button" class="copy" disabled title="Fix the invalid lines first">${label}</button>`
    : `<button type="button" class="copy" data-copy="${esc(text)}">${label}</button>`;

/** Split a textarea into networks and per-line errors. Line numbers are 1-based. */
export function parseNetworks(text) {
  const items = [];
  const errors = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
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

const errorLines = (errors) =>
  errors
    .map((e) => `<p class="notice is-error"><strong>Line ${e.line}:</strong> <code>${esc(e.text)}</code> ${esc(e.message)}.</p>`)
    .join('');

const blockedNotice = (errors) =>
  `<p class="notice is-error"><strong>${errors.length} line${errors.length === 1 ? '' : 's'} could not be read.</strong> Copying is disabled and the results below cover only the valid lines. Fix the input to get a complete result.</p>`;

/**
 * @returns {{ errors: string, agg: string, sup: string, ovl: string, blocked: boolean, summary: string }}
 */
export function renderNets(text) {
  const { items, errors } = parseNetworks(text);
  const blocked = errors.length > 0;
  const out = {
    errors: (blocked ? blockedNotice(errors) : '') + errorLines(errors),
    agg: '',
    sup: '',
    ovl: '',
    blocked,
    summary: '',
  };
  if (!items.length) return out;

  const summary = [];
  const byVersion = [4, 6].map((v) => items.filter((x) => x.cidr.version === v)).filter((l) => l.length);
  for (const list of byVersion) {
    const cidrs = list.map((x) => x.cidr);
    const merged = aggregate(cidrs);
    out.agg += `<div class="row"><span class="k">${list.length} in → ${merged.length} out</span>${copyBtn(merged.map(formatCidr).join('\n'), 'copy', blocked)}</div><ul>${merged
      .map((c) => `<li>${esc(formatCidr(c))}</li>`)
      .join('')}</ul>`;
    const s = supernet(cidrs);
    const covered = merged.reduce((a, c) => a + size(c), 0n);
    const extra = size(s) - covered;
    out.sup += `<div class="row"><b>${esc(formatCidr(s))}</b>${copyBtn(formatCidr(s), 'copy', blocked)}</div><div class="row"><span class="k">covers</span><span>${count(size(s))} addresses</span></div><div class="row"><span class="k">not in your list</span><span${extra > 0n ? ' class="warn"' : ''}>${count(extra)}</span></div>`;
    summary.push(
      `${formatCidr(cidrs[0]).includes(':') ? 'IPv6' : 'IPv4'}: ${list.length} in → ${merged.length} out (${merged.map(formatCidr).join(', ')}); supernet ${formatCidr(s)} with ${extra} address${extra === 1n ? '' : 'es'} not in the list`,
    );
  }

  const pairs = findOverlaps(items.map((x) => x.cidr));
  if (blocked) {
    out.ovl = `<span class="warn"><strong>Overlap check incomplete:</strong> ${errors.length} line${errors.length === 1 ? '' : 's'} could not be read. Fix the input for a complete check.</span>`;
    if (pairs.length) out.ovl += overlapList(pairs, items, 'Overlaps found among the valid lines:');
    summary.push(`Overlap check incomplete: ${errors.length} invalid line${errors.length === 1 ? '' : 's'}${pairs.length ? `; ${pairs.length} overlapping pair${pairs.length === 1 ? '' : 's'} among the valid lines` : ''}`);
  } else if (!pairs.length) {
    out.ovl = `<span class="k">No overlaps among ${items.length} network${items.length === 1 ? '' : 's'}.</span>`;
    summary.push(`Overlaps: none among ${items.length} networks`);
  } else {
    out.ovl = overlapList(pairs, items);
    summary.push(`Overlaps: ${pairs.length} overlapping pair${pairs.length === 1 ? '' : 's'}`);
  }

  out.summary = [
    'CIDR report',
    'Input:',
    ...items.map((x) => `  ${x.text}`),
    ...(blocked ? errors.map((e) => `  line ${e.line} could not be read: ${e.text}`) : []),
    ...summary,
    'Rule: aggregation merges blocks into the fewest CIDRs covering exactly the same addresses; the supernet is the smallest single block containing all of them.',
    'Computed with SubnetCalc (https://subnetcalc.dev).',
  ].join('\n') + '\n';
  return out;
}

function overlapList(pairs, items, heading = '') {
  const word = { equal: 'is the same as', contains: 'contains', contained: 'is inside' };
  return `${heading ? `<p class="k" style="margin: var(--s2) 0">${esc(heading)}</p>` : ''}<ul>${pairs
    .map((p) => {
      const a = items[p.i];
      const b = items[p.j];
      return `<li><span class="warn">line ${a.line}</span> ${esc(formatCidr(a.cidr))} ${word[p.relation]} <span class="warn">line ${b.line}</span> ${esc(formatCidr(b.cidr))}</li>`;
    })
    .join('')}</ul>`;
}

/**
 * Full report for the overlap checker page.
 * @returns {{ errors: string, report: string, blocked: boolean, summary: string, pairs: number }}
 */
export function renderOverlapReport(text) {
  const { items, errors } = parseNetworks(text);
  const blocked = errors.length > 0;
  const v4 = items.filter((x) => x.cidr.version === 4).length;
  const v6 = items.length - v4;
  const pairs = findOverlaps(items.map((x) => x.cidr));
  let report = '';
  if (items.length) {
    report += `<div class="row"><span class="k">Checked</span><span>${items.length} network${items.length === 1 ? '' : 's'} (${v4} IPv4, ${v6} IPv6)</span></div>`;
  }
  if (blocked) {
    report += `<div class="row"><span class="k">Result</span><span class="warn"><b>Incomplete:</b> ${errors.length} line${errors.length === 1 ? '' : 's'} could not be read</span></div>`;
    if (pairs.length) report += overlapList(pairs, items, 'Overlaps found among the valid lines:');
  } else if (!items.length) {
    report = '';
  } else if (!pairs.length) {
    report += `<div class="row"><span class="k">Result</span><span><b>No overlaps</b> among ${items.length} network${items.length === 1 ? '' : 's'}</span></div>`;
  } else {
    report += `<div class="row"><span class="k">Overlapping pairs</span><span class="warn"><b>${pairs.length}</b></span></div>`;
    report += overlapList(pairs, items);
  }
  const summary = [
    'CIDR overlap check',
    'Input:',
    ...items.map((x) => `  ${x.text}`),
    ...(blocked ? errors.map((e) => `  line ${e.line} could not be read: ${e.text}`) : []),
    blocked
      ? `Result: incomplete, ${errors.length} invalid line${errors.length === 1 ? '' : 's'}${pairs.length ? `; ${pairs.length} overlapping pair${pairs.length === 1 ? '' : 's'} found among the valid lines` : ''}`
      : items.length
        ? pairs.length
          ? `Result: ${pairs.length} overlapping pair${pairs.length === 1 ? '' : 's'}`
          : `Result: no overlaps among ${items.length} network${items.length === 1 ? '' : 's'}`
        : 'Result: no networks entered',
    'Rule: CIDR blocks either do not overlap or one fully contains the other; every such pair is listed.',
    'Computed with SubnetCalc (https://subnetcalc.dev).',
  ].join('\n') + '\n';
  return { errors: (blocked ? blockedNotice(errors) : '') + errorLines(errors), report, blocked, summary, pairs: pairs.length };
}

/** CIDR block list for a start..end range, or a readable error. */
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

/** Ticket-ready text for the range tool. */
export function rangeSummary(a, b) {
  try {
    const list = rangeToCidrs(a, b);
    const total = list.reduce((s, c) => s + size(c), 0n);
    return [
      'IP range to CIDR',
      `Range: ${a} - ${b} (inclusive)`,
      `${list.length} block${list.length === 1 ? '' : 's'} covering ${group(total)} addresses:`,
      ...list.map((c) => `  ${formatCidr(c)}`),
      'Rule: start at the first address, take the largest aligned block that stays inside the range, then repeat from the next address.',
      'Computed with SubnetCalc (https://subnetcalc.dev).',
    ].join('\n') + '\n';
  } catch (e) {
    if (!(e instanceof SubnetError)) throw e;
    return null;
  }
}
