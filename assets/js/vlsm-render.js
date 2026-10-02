// HTML/SVG renderers for the VLSM planner. Pure string functions (also used for pre-rendering).
import { formatCidr } from '../../lib/subnet.js';
import {
  planToCSV,
  planToJSON,
  planToMarkdown,
  planToTerraform,
  planToAWS,
  planToAzure,
  planToCisco,
} from '../../lib/export.js';
import { esc, group } from './ui.js';

export const DEFAULT_PARENT = '192.168.1.0/24';
export const DEFAULT_REQUESTS = [
  { name: 'Sales', hosts: 120 },
  { name: 'Eng', hosts: 50 },
  { name: 'Mgmt', hosts: 10 },
  { name: 'P2P', hosts: 2 },
];

export const EXPORTS = [
  { id: 'csv', label: 'CSV', ext: 'csv', type: 'text/csv', fn: planToCSV },
  { id: 'json', label: 'JSON', ext: 'json', type: 'application/json', fn: planToJSON },
  { id: 'md', label: 'Markdown', ext: 'md', type: 'text/markdown', fn: planToMarkdown },
  { id: 'tf', label: 'Terraform', ext: 'tf', type: 'text/plain', fn: planToTerraform },
  { id: 'aws', label: 'AWS', ext: 'txt', type: 'text/plain', fn: planToAWS },
  { id: 'azure', label: 'Azure', ext: 'txt', type: 'text/plain', fn: planToAzure },
  { id: 'cisco', label: 'Cisco IOS', ext: 'txt', type: 'text/plain', fn: planToCisco },
];

const pct = (a, b) => (Number((a * 1000n) / b) / 10).toFixed(1);

export function renderSummary(plan) {
  const total = plan.usedAddresses + plan.freeAddresses;
  return `<p class="summary-line">
<span>parent <b>${esc(formatCidr(plan.parent))}</b></span>
<span>subnets <b>${plan.allocations.length}</b></span>
<span>allocated <b>${group(plan.usedAddresses)}</b> of ${group(total)} (${pct(plan.usedAddresses, total)}%)</span>
<span>free <b>${group(plan.freeAddresses)}</b></span>
</p>`;
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

export function renderTable(plan) {
  const rows = plan.allocations
    .map(
      (a) => `<tr>
<td class="name">${esc(a.name)}</td><td class="num">${group(a.hostsRequested)}</td><td><b>${esc(a.cidr)}</b></td><td>${esc(a.netmask)}</td><td>${esc(a.firstHost)} – ${esc(a.lastHost)}</td><td>${a.broadcast ? esc(a.broadcast) : '—'}</td><td class="num">${group(a.usableHosts)}</td><td class="num">${group(a.wasted)}</td>
</tr>`,
    )
    .join('\n');
  return `<div class="table-wrap" tabindex="0"><table class="data">
<thead><tr><th scope="col">Name</th><th scope="col" class="num">Hosts</th><th scope="col">Subnet</th><th scope="col">Netmask</th><th scope="col">Usable range</th><th scope="col">Broadcast</th><th scope="col" class="num">Usable</th><th scope="col" class="num">Unused</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
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
