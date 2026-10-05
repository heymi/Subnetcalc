// HTML/SVG renderers for the VLSM planner. Pure string functions (also used for pre-rendering).
import { formatCidr } from '../../lib/subnet.js';
import {
  planToCSV,
  planToJSON,
  planToMarkdown,
  planToTerraform,
  planToAWS,
  planToAzure,
  planToGCP,
  planToCloudFormation,
  planToBicep,
  planToCisco,
  planToOspf,
  planToAcl,
  planToRoute,
} from '../../lib/export.js';
import { esc, group } from './ui.js';

/**
 * Parse a VLSM share query (?p=&r=&s31=&s32=&c=) defensively. Malformed percent escapes
 * and empty host counts never throw; they are reported so the page can ask for the value.
 * @returns {{ parent: string, entries: {name: string, hosts: number}[], s31: boolean, s32: boolean, cloud: string, bad: string[], incomplete: boolean } | null}
 */
export function parseVlsmSearch(search) {
  const raw = String(search || '');
  const sp = new URLSearchParams(raw.replace(/\+/g, '%2B'));
  const p = sp.get('p');
  const hasR = sp.has('r');
  if (p === null && !hasR) return null;
  const rRaw = hasR ? (/[?&]r(?:=([^&]*))?/.exec(raw)?.[1] ?? '') : null;
  const bad = [];
  const entries = [];
  for (const item of (rRaw || '').split(',').filter(Boolean)) {
    const i = item.lastIndexOf(':');
    let name = i === -1 ? item : item.slice(0, i);
    try {
      name = decodeURIComponent(name);
    } catch {
      bad.push(name);
    }
    const hostsRaw = i === -1 ? '' : item.slice(i + 1);
    entries.push({ name, hosts: /^\d+$/.test(hostsRaw) ? Number(hostsRaw) : NaN });
  }
  const cloud = sp.get('c');
  return {
    parent: p ?? DEFAULT_PARENT,
    entries,
    s31: sp.get('s31') === '1',
    s32: sp.get('s32') === '1',
    cloud: cloud && Object.hasOwn(CLOUD_RULES, cloud) ? cloud : 'generic',
    bad,
    incomplete: entries.some((e) => !Number.isFinite(e.hosts)),
  };
}

export const DEFAULT_PARENT = '192.168.1.0/24';
export const DEFAULT_REQUESTS = [
  { name: 'LAN', hosts: 60 },
  { name: 'Staff', hosts: 30 },
  { name: 'Lab', hosts: 12 },
  { name: 'Link', hosts: 2 },
];

/** Fixed capacity example: four /26 requests do not fit a /28. */
export const CAPACITY_PARENT = '10.0.0.0/28';
export const CAPACITY_REQUESTS = [
  { name: 'Office', hosts: 20 },
  { name: 'Lab', hosts: 20 },
];

/**
 * Capacity rules the planner can allocate under. The generic rule is the classic
 * network + broadcast reservation; cloud rules reserve 5 addresses and set a
 * minimum subnet size, so allocation and the AWS/Azure exports agree.
 */
export const CLOUD_RULES = {
  generic: { provider: null, reservedHosts: 2, reserveHead: 1, reserveTail: 1, minPrefix: 32, maxPrefix: 0, label: 'Generic' },
  aws: { provider: 'aws', reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 28, maxPrefix: 16, label: 'AWS VPC' },
  azure: { provider: 'azure', reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 29, maxPrefix: 0, label: 'Azure VNet' },
  gcp: { provider: 'gcp', reservedHosts: 4, reserveHead: 2, reserveTail: 2, minPrefix: 29, maxPrefix: 0, label: 'Google Cloud VPC' },
};

/**
 * Read pasted "name hosts" lines. Every non-empty line is kept: unreadable lines come
 * back in `entries` as errors so the caller can show them instead of dropping them.
 * @returns {{ entries: ({name: string, hosts: number} | {error: true, line: number, text: string})[], rows: object[], errors: object[] }}
 */
export function parseRequestList(text) {
  const entries = [];
  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const t = raw.trim();
      if (!t) return;
      let m = t.match(/^(.*?)[\s,;:=|]+(\d+)\s*(?:hosts?)?$/i);
      if (m && m[1]) {
        entries.push({ name: m[1].replace(/[,;:=|]+$/, '').trim(), hosts: Number(m[2]) });
        return;
      }
      m = t.match(/^(\d+)[\s,;:=|]+(.+)$/);
      if (m) {
        entries.push({ name: m[2].trim(), hosts: Number(m[1]) });
        return;
      }
      entries.push({ error: true, line: i + 1, text: t });
    });
  return {
    entries,
    rows: entries.filter((e) => !e.error),
    errors: entries.filter((e) => e.error),
  };
}

export const EXPORTS = [
  { id: 'csv', label: 'CSV', ext: 'csv', type: 'text/csv', fn: planToCSV },
  { id: 'json', label: 'JSON', ext: 'json', type: 'application/json', fn: planToJSON },
  { id: 'md', label: 'Markdown', ext: 'md', type: 'text/markdown', fn: planToMarkdown },
  { id: 'tf', label: 'Terraform', ext: 'tf', type: 'text/plain', fn: planToTerraform },
  { id: 'aws', label: 'AWS', ext: 'txt', type: 'text/plain', fn: planToAWS },
  { id: 'azure', label: 'Azure', ext: 'txt', type: 'text/plain', fn: planToAzure },
  { id: 'gcp', label: 'GCP', ext: 'txt', type: 'text/plain', fn: planToGCP },
  { id: 'cfn', label: 'CloudFormation', ext: 'yaml', type: 'text/yaml', fn: planToCloudFormation },
  { id: 'bicep', label: 'Bicep', ext: 'bicep', type: 'text/plain', fn: planToBicep },
  { id: 'cisco', label: 'Cisco IOS', ext: 'txt', type: 'text/plain', fn: planToCisco },
  { id: 'ospf', label: 'OSPF', ext: 'txt', type: 'text/plain', fn: planToOspf },
  { id: 'acl', label: 'ACL', ext: 'txt', type: 'text/plain', fn: planToAcl },
  { id: 'route', label: 'Route', ext: 'txt', type: 'text/plain', fn: planToRoute },
];

const pct = (a, b) => (Number((a * 1000n) / b) / 10).toFixed(1);

export function renderSummary(plan) {
  const total = plan.usedAddresses + plan.freeAddresses;
  const first = plan.allocations[0];
  const why = first
    ? `<p class="hint">Largest first: <b>${esc(first.name)}</b> takes the first /${first.prefix} (${group(1n << BigInt(32 - first.prefix))} addresses), so every smaller block that follows starts on a multiple of its own size with no gaps.</p>`
    : '';
  return `<p class="summary-line">
<span>parent <b>${esc(formatCidr(plan.parent))}</b></span>
<span>subnets <b>${plan.allocations.length}</b></span>
<span>allocated <b>${group(plan.usedAddresses)}</b> of ${group(total)} (${pct(plan.usedAddresses, total)}%)</span>
<span>free <b>${group(plan.freeAddresses)}</b></span>
</p>${why}`;
}

/** Proportional bar of the parent block: allocations in network blue, free space hatched. */
export function renderMap(plan) {
  const start = plan.parent.value;
  const size = plan.usedAddresses + plan.freeAddresses;
  const pctOf = (v) => (Number((v * 1000000n) / size) / 10000).toFixed(4);
  const blocks = [
    ...plan.allocations.map((a, i) => ({ c: a.block, name: a.name, alloc: true, i })),
    ...plan.free.map((c) => ({ c, name: 'free', alloc: false })),
  ];
  const cells = blocks
    .map((b) => {
      const n = 1n << BigInt(32 - b.c.prefix);
      const label = `${b.name} · ${formatCidr(b.c)} · ${group(n)} addresses`;
      const cls = b.alloc ? (b.i % 2 ? 'a alt' : 'a') : 'f';
      return `<span class="${cls}" style="left:${pctOf(b.c.value - start)}%;width:${pctOf(n)}%" title="${esc(label)}"><span>${esc(b.name)}</span></span>`;
    })
    .join('');
  return `<div class="addr-map" role="img" aria-label="Address map of ${esc(formatCidr(plan.parent))}: ${plan.allocations.length} subnets, ${group(plan.freeAddresses)} addresses free">
<div class="addr-bar">${cells}</div>
<div class="addr-ends"><span>${esc(formatCidr(plan.parent).split('/')[0])}</span><span>${esc(lastAddress(plan))}</span></div>
</div>`;
}

function lastAddress(plan) {
  const v = plan.parent.value + plan.usedAddresses + plan.freeAddresses - 1n;
  return [24n, 16n, 8n, 0n].map((s) => String((v >> s) & 0xffn)).join('.');
}

const blockSize = (a) => 1n << BigInt(32 - a.prefix);

function ipv4(v) {
  return [24n, 16n, 8n, 0n].map((s) => String((v >> s) & 0xffn)).join('.');
}

const COLS = ['Subnet', 'Hosts needed', 'Block size', 'Prefix', 'Network', 'First usable', 'Last usable', 'Broadcast', 'Subnet mask', 'Wasted'];

function planRows(plan) {
  return plan.allocations.map((a) => [
    a.name,
    group(a.hostsRequested),
    group(blockSize(a)),
    `/${a.prefix}`,
    a.network,
    a.firstHost,
    a.lastHost,
    a.broadcast || '—',
    a.netmask,
    group(a.wasted),
  ]);
}

export function renderTable(plan) {
  const rows = planRows(plan)
    .map(
      (c) => `<tr>
<td class="name">${esc(c[0])}</td><td class="num">${c[1]}</td><td class="num">${c[2]}</td><td>${c[3]}</td><td>${esc(c[4])}</td><td>${esc(c[5])}</td><td>${esc(c[6])}</td><td>${esc(c[7])}</td><td>${esc(c[8])}</td><td class="num">${c[9]}</td>
</tr>`,
    )
    .join('\n');
  return `<div class="table-wrap" tabindex="0"><table class="data">
<thead><tr>${COLS.map((h, i) => `<th scope="col"${i === 1 || i === 2 || i === 9 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

/** Tab-separated rows for pasting into a spreadsheet. */
export function planTableTSV(plan) {
  return [COLS.join('\t'), ...planRows(plan).map((r) => r.join('\t'))].join('\n');
}

export function planTableCSV(plan) {
  const cell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [COLS.join(','), ...planRows(plan).map((r) => r.map(cell).join(','))].join('\n');
}

/** Step-by-step text for the current plan. The same function pre-renders the default example. */
export function renderWorked(plan) {
  const alloc = plan.allocations;
  if (!alloc.length) return '<p class="hint">Add a subnet to see these steps.</p>';
  const reserved = plan.reservedHosts;
  const order = alloc.map((a) => `${esc(a.name)} ${group(a.hostsRequested)}`).join(', ');
  const sized = alloc
    .map((a) => {
      const size = blockSize(a);
      if (a.prefix >= 31) {
        return `${esc(a.name)}: ${group(a.hostsRequested)} hosts use ${group(size)} addresses, with no network or broadcast reserved`;
      }
      const raw = BigInt(a.hostsRequested) + BigInt(reserved);
      let pow = 1n;
      while (pow < raw) pow <<= 1n;
      const tail = size === pow ? `rounds up to ${group(size)}` : `would round to ${group(pow)}, and this rule assigns ${group(size)}`;
      return `${esc(a.name)}: ${group(a.hostsRequested)} + ${reserved} = ${group(raw)} ${tail}`;
    })
    .join('; ');
  const step2 = alloc.some((a) => a.prefix < 31)
    ? `Add the ${reserved} reserved ${reserved === 1 ? 'address' : 'addresses'} and round up to a power of two. ${sized}.`
    : `These blocks do not reserve a network or broadcast address. ${sized}.`;
  const masks = alloc
    .map((a) => `${group(blockSize(a))} addresses is /${a.prefix} (${esc(a.netmask)})`)
    .join('; ');
  const placed = alloc
    .map((a, i) => {
      const size = blockSize(a);
      const end = a.block.value + size - 1n;
      const next = ipv4(a.block.value + size);
      const tail = i === alloc.length - 1 ? '' : ` The next subnet starts at ${next}.`;
      return `${esc(a.name)} takes ${esc(a.network)}–${ipv4(end)}.${tail}`;
    })
    .join(' ');
  const wasted = alloc.reduce((n, a) => n + a.wasted, 0n);
  const total = plan.usedAddresses + plan.freeAddresses;
  return `<ol class="steps">
<li><span>Sort the requests by host count, largest first: ${order}. Equal sizes keep the order you typed.</span></li>
<li><span>${step2}</span></li>
<li><span>The block size is the prefix and the mask. ${masks}.</span></li>
<li><span>Allocate from ${esc(ipv4(plan.parent.value))}. ${placed}</span></li>
<li><span>This uses ${group(plan.usedAddresses)} of ${group(total)} addresses. ${group(plan.freeAddresses)} remain. ${group(wasted)} ${wasted === 1n ? 'address is' : 'addresses are'} unused inside the subnets (usable hosts above the request).</span></li>
</ol>`;
}

export function renderFree(plan) {
  if (!plan.free.length) return '<p class="hint">No free space left in the parent block.</p>';
  return `<p class="hint">Free blocks: ${plan.free.map((c) => `<code>${esc(formatCidr(c))}</code>`).join(' ')}</p>`;
}

/**
 * Indented binary split tree. `collapsed` holds the CIDR strings of split nodes the user folded.
 */
export function renderTree(plan, collapsed = new Set()) {
  const rows = [];
  const walk = (node, depth, guides) => {
    const key = formatCidr(node.cidr);
    const folded = node.state === 'split' && collapsed.has(key);
    rows.push({ node, depth, key, folded, guides });
    if (node.state === 'split' && !folded) {
      node.children.forEach((ch, i) => walk(ch, depth + 1, [...guides, i === 0]));
    }
  };
  walk(plan.tree, 0, []);

  const RH = 26;
  const IND = 20;
  const PAD = 8;
  let maxX = 0;
  const parts = [];
  rows.forEach((r, idx) => {
    const y = idx * RH + RH / 2;
    const x = PAD + r.depth * IND;
    // connectors: vertical guides for ancestors that still have a lower sibling, elbow for this node
    r.guides.forEach((hasLowerSibling, d) => {
      const gx = PAD + d * IND + 5;
      const isLast = d === r.guides.length - 1;
      if (isLast) {
        parts.push(`<path d="M${gx} ${y - RH / 2}V${y}H${x - 3}" class="t-ln"/>`);
        if (hasLowerSibling) parts.push(`<path d="M${gx} ${y}V${y + RH / 2}" class="t-ln"/>`);
      } else if (hasLowerSibling) {
        parts.push(`<path d="M${gx} ${y - RH / 2}V${y + RH / 2}" class="t-ln"/>`);
      }
    });
    const n = r.node;
    const size = 1n << BigInt(32 - n.cidr.prefix);
    let mark;
    let label;
    let cls = n.state;
    if (n.state === 'allocated') {
      mark = `<rect x="${x}" y="${y - 5}" width="10" height="10" class="t-alloc"/>`;
      label = `<tspan class="t-name">${esc(n.name)}</tspan>`;
    } else if (n.state === 'free') {
      mark = `<rect x="${x + 0.5}" y="${y - 4.5}" width="9" height="9" class="t-free"/>`;
      label = '<tspan class="t-muted">free</tspan>';
    } else {
      mark = `<rect x="${x + 0.5}" y="${y - 4.5}" width="9" height="9" class="t-split"/><path d="M${x + 2.5} ${y}h5${r.folded ? `M${x + 5} ${y - 2.5}v5` : ''}" class="t-sign"/>`;
      if (!r.folded) parts.push(`<path d="M${x + 5} ${y + 4.5}V${y + RH / 2}" class="t-ln"/>`);
      label = `<tspan class="t-muted">${r.folded ? 'collapsed' : `split into 2 × /${n.cidr.prefix + 1}`}</tspan>`;
    }
    const text = `${r.key}`;
    const tx = x + 16;
    const textW = (text.length + 2) * 7.3 + (n.name ? n.name.length * 7.8 : 12 * 7.3);
    maxX = Math.max(maxX, tx + textW + 90);
    const sizeLabel = `<tspan class="t-muted" dx="10">${group(size)}</tspan>`;
    const body = `${mark}<text x="${tx}" y="${y + 4}"><tspan class="t-cidr">${esc(text)}</tspan><tspan dx="10">${label}</tspan>${sizeLabel}</text>`;
    if (n.state === 'split') {
      parts.push(
        `<g class="node split" tabindex="0" role="button" data-node="${esc(r.key)}" aria-expanded="${!r.folded}" aria-label="${esc(r.key)}: ${r.folded ? 'expand' : 'collapse'}"><rect class="hit" x="${x - 3}" y="${y - RH / 2 + 2}" width="${textW + 30}" height="${RH - 4}" rx="2"/>${body}</g>`,
      );
    } else {
      parts.push(`<g class="node ${cls}">${body}</g>`);
    }
  });
  const H = rows.length * RH + 4;
  const W = Math.ceil(maxX);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Split tree of ${esc(formatCidr(plan.parent))}">
<style>.t-ln{stroke:var(--line-strong);fill:none;stroke-width:1}.t-alloc{fill:var(--net)}.t-free{fill:none;stroke:var(--host);stroke-dasharray:2 2}.t-split{fill:var(--bg);stroke:var(--fg)}.t-sign{stroke:var(--fg);stroke-width:1.4}text{font:400 12.5px var(--mono);fill:var(--fg)}.t-name{font-weight:600;fill:var(--net)}.t-muted{fill:var(--muted)}.hit{fill:transparent}.node.split:hover .hit{fill:var(--surface)}</style>
${parts.join('\n')}
</svg>`;
}

/** Smallest prefix whose block holds every request (sizes are powers of two, so the sum decides). */
export function fittingPrefix(requests, prefixFor) {
  let total = 0n;
  for (const r of requests) total += 1n << BigInt(32 - prefixFor(r));
  let p = 32;
  while (p > 0 && 1n << BigInt(32 - p) < total) p--;
  return 1n << BigInt(32 - p) >= total ? p : null;
}
