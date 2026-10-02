// subnetcalc export formatters. MIT License. https://subnetcalc.dev
//
// Turns results from lib/subnet.js into text for the clipboard or a download.
// No math here: everything is read from the objects subnet.js returns.

import { cidrsubnetArgs, formatCidr } from './subnet.js';

// Field order and labels for one analyze() result.
const INFO_FIELDS = [
  ['address', 'Address'],
  ['cidr', 'Network'],
  ['netmask', 'Netmask'],
  ['wildcard', 'Wildcard'],
  ['prefix', 'Prefix length'],
  ['broadcast', 'Broadcast'],
  ['firstHost', 'First usable host'],
  ['lastHost', 'Last usable host'],
  ['usableHosts', 'Usable hosts'],
  ['totalAddresses', 'Total addresses'],
  ['ipClass', 'Class'],
  ['ipv6Type', 'IPv6 type'],
  ['slash64', '/64 network'],
  ['slash64Count', '/64 subnets'],
];

const str = (v) => (typeof v === 'bigint' ? v.toString() : String(v));

function rows(info) {
  const out = [];
  for (const [key, label] of INFO_FIELDS) {
    const v = info[key];
    if (v !== null && v !== undefined) out.push([key, label, str(v)]);
  }
  if (info.special) {
    out.push(['special', 'Special-purpose block', `${info.special.name} (${info.special.block}, ${info.special.rfc})`]);
    if (info.special.globallyReachable !== null) {
      out.push(['globallyReachable', 'Globally reachable', info.special.globallyReachable ? 'yes' : 'no']);
    }
  }
  const e = info.embedded;
  if (e) {
    const val =
      e.kind === 'teredo' ? `Teredo server ${e.server}, client ${e.client}, port ${e.port}` : `${e.kind} ${e.ipv4}`;
    out.push(['embedded', 'Embedded IPv4', val]);
  }
  return out;
}

/** Aligned "Label: value" lines. */
export function toText(info) {
  const r = rows(info);
  const width = Math.max(...r.map(([, label]) => label.length));
  return r.map(([, label, v]) => `${(label + ':').padEnd(width + 1)} ${v}`).join('\n') + '\n';
}

/** JSON with BigInt counts as decimal strings; drops the internal `parsed` object. */
export function toJSON(info) {
  const { parsed, ...rest } = info;
  return JSON.stringify(rest, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n';
}

const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Two-column CSV (field,value), RFC 4180 quoting. */
export function toCSV(info) {
  return ['field,value', ...rows(info).map(([key, , v]) => `${key},${csvCell(v)}`)].join('\r\n') + '\r\n';
}

// ───────────────────────────── VLSM plan exports ─────────────────────────────
// Each takes the `plan` from planVlsm(...).plan.

const PLAN_COLUMNS = [
  ['name', 'Name'],
  ['hostsRequested', 'Hosts needed'],
  ['cidr', 'Subnet'],
  ['netmask', 'Netmask'],
  ['firstHost', 'First host'],
  ['lastHost', 'Last host'],
  ['broadcast', 'Broadcast'],
  ['usableHosts', 'Usable'],
  ['wasted', 'Unused'],
];

const cell = (a, k) => (a[k] === null ? '' : str(a[k]));

export function planToCSV(plan) {
  const lines = [PLAN_COLUMNS.map(([k]) => k).join(',')];
  for (const a of plan.allocations) lines.push(PLAN_COLUMNS.map(([k]) => csvCell(cell(a, k))).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function planToJSON(plan) {
  const out = {
    parent: formatCidr(plan.parent),
    subnets: plan.allocations.map((a) => {
      const o = {};
      for (const [k] of PLAN_COLUMNS) o[k] = typeof a[k] === 'bigint' ? Number(a[k]) : a[k];
      return o;
    }),
    free: plan.free.map((c) => formatCidr(c)),
    usedAddresses: Number(plan.usedAddresses),
    freeAddresses: Number(plan.freeAddresses),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

const mdCell = (v) => v.replace(/\|/g, '\\|');

export function planToMarkdown(plan) {
  const head = `| ${PLAN_COLUMNS.map(([, l]) => l).join(' | ')} |`;
  const rule = `| ${PLAN_COLUMNS.map(([k]) => (k === 'hostsRequested' || k === 'usableHosts' || k === 'wasted' ? '---:' : '---')).join(' | ')} |`;
  const body = plan.allocations.map((a) => `| ${PLAN_COLUMNS.map(([k]) => mdCell(cell(a, k) || '—')).join(' | ')} |`);
  const free = plan.free.length ? `\nFree: ${plan.free.map((c) => formatCidr(c)).join(', ')}\n` : '';
  return [head, rule, ...body].join('\n') + '\n' + free;
}

const hclString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$\{/g, '$$$${').replace(/%\{/g, '%%{')}"`;

/** Terraform locals using cidrsubnet(), so the plan follows the parent if it changes. */
export function planToTerraform(plan) {
  const parent = formatCidr(plan.parent);
  const keys = plan.allocations.map((a) => hclString(a.name));
  const width = Math.max(0, ...keys.map((k) => k.length));
  const lines = plan.allocations.map((a, i) => {
    const { newbits, netnum } = cidrsubnetArgs(plan.parent, a.block);
    return `    ${keys[i].padEnd(width)} = cidrsubnet(local.base_cidr, ${newbits}, ${netnum}) # ${a.cidr}`;
  });
  return `# VLSM plan for ${parent}\nlocals {\n  base_cidr = "${parent}"\n\n  subnets = {\n${lines.join('\n')}\n  }\n}\n`;
}

function cloudList(plan, { provider, minPrefix }) {
  const width = Math.max(...plan.allocations.map((a) => a.cidr.length), 0);
  const lines = [`# ${provider} subnet CIDRs for ${formatCidr(plan.parent)}`, `# ${provider} reserves 5 addresses in every subnet; smallest allowed subnet is /${minPrefix}.`];
  for (const a of plan.allocations) {
    const size = 2 ** (32 - a.prefix);
    const usable = size - 5;
    let note = `${a.name} (${a.hostsRequested} hosts)`;
    if (a.prefix > minPrefix) note += ` WARNING: /${a.prefix} is smaller than the ${provider} minimum /${minPrefix}`;
    else if (usable < a.hostsRequested) note += ` WARNING: only ${usable} usable after ${provider} reserves 5`;
    lines.push(`${a.cidr.padEnd(width)}  # ${note}`);
  }
  return lines.join('\n') + '\n';
}

export const planToAWS = (plan) => cloudList(plan, { provider: 'AWS', minPrefix: 28 });
export const planToAzure = (plan) => cloudList(plan, { provider: 'Azure', minPrefix: 29 });

/** Cisco IOS interface snippets: first usable host as the router address. */
export function planToCisco(plan) {
  const out = [];
  for (const a of plan.allocations) {
    out.push(`! ${a.name}: ${a.cidr}, ${str(a.usableHosts)} usable`);
    out.push('interface <INTERFACE>');
    out.push(` description ${a.name.replace(/[\r\n]+/g, ' ')}`);
    out.push(` ip address ${a.firstHost} ${a.netmask}`);
    out.push('!');
  }
  return out.join('\n') + '\n';
}
