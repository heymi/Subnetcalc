// subnetcalc export formatters. MIT License. https://subnetcalc.dev
//
// Turns results from lib/subnet.js into text for the clipboard or a download.
// No math here: everything is read from the objects subnet.js returns.

import { cidrsubnetArgs, formatAddress, formatCidr, prefixToMask } from './subnet.js';

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

/** One plain sentence describing the rule behind the numbers, for ticket text. */
export function ruleText(info) {
  if (info.version === 4) {
    const hostBits = 32 - info.prefix;
    if (info.prefix === 32) return 'Rule: /32 is a single host route, so the one address is usable.';
    if (info.prefix === 31) return 'Rule: /31 follows RFC 3021: both addresses are usable and there is no broadcast.';
    return `Rule: /${info.prefix} = ${info.prefix} network + ${hostBits} host bits. Usable hosts = 2^${hostBits} - 2 = ${info.usableHosts} (network and broadcast are not assigned).`;
  }
  const hostBits = 128 - info.prefix;
  let s = `Rule: /${info.prefix} = ${info.prefix} network + ${hostBits} host bits. IPv6 has no broadcast, so all 2^${hostBits} addresses count as usable.`;
  if (info.slash64) s += ` The address sits in the /64 ${info.slash64}.`;
  else if (info.slash64Count) s += ` That is ${info.slash64Count} /64 subnets.`;
  return s;
}

/**
 * Ticket-ready text: what was entered, the main results, and the rule behind them.
 * Field values come from the same analyze() result the page renders.
 */
export function toExplain(info) {
  const lines = [`Input: ${info.input.trim()}`, `Network: ${info.cidr}`];
  if (info.version === 4) {
    lines.push(`Broadcast: ${info.broadcast ?? 'none'}`);
    lines.push(`Usable range: ${info.firstHost} - ${info.lastHost}`);
    lines.push(`Usable hosts: ${info.usableHosts}`);
    lines.push(`Netmask: ${info.netmask}  Wildcard: ${info.wildcard}`);
  } else {
    lines.push(`Address range: ${info.firstHost} - ${info.lastHost}`);
    lines.push(`Addresses: ${info.totalAddresses}`);
  }
  if (info.special) lines.push(`Block: ${info.special.name} (${info.special.block}, ${info.special.rfc})`);
  if (info.embedded) {
    const e = info.embedded;
    lines.push(e.kind === 'teredo' ? `Teredo: server ${e.server}, client ${e.client}, port ${e.port}` : `Embedded IPv4: ${e.ipv4}`);
  }
  lines.push(ruleText(info));
  lines.push('Computed with SubnetCalc (https://subnetcalc.dev) - all arithmetic runs in the browser.');
  return lines.join('\n') + '\n';
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
  const names = new Set(plan.allocations.map((a) => a.name));
  const used = new Set();
  const keys = plan.allocations.map((a) => {
    let key = a.name;
    let suffix = 2;
    if (used.has(key)) {
      do { key = `${a.name} (${suffix++})`; } while (names.has(key) || used.has(key));
    }
    used.add(key);
    return hclString(key);
  });
  const width = Math.max(0, ...keys.map((k) => k.length));
  const lines = plan.allocations.map((a, i) => {
    const { newbits, netnum } = cidrsubnetArgs(plan.parent, a.block);
    return `    ${keys[i].padEnd(width)} = cidrsubnet(local.base_cidr, ${newbits}, ${netnum}) # ${a.cidr}`;
  });
  return `# VLSM plan for ${parent}\nlocals {\n  base_cidr = "${parent}"\n\n  subnets = {\n${lines.join('\n')}\n  }\n}\n`;
}

/**
 * Provider rule checks for one allocation, shared by every cloud export so a plan built
 * under another rule cannot leave without a warning.
 * @returns {string[]} warning texts, without the "WARNING:" prefix
 */
function capacityWarnings(a, { provider, reserved, minPrefix, maxPrefix = 0 }) {
  const size = 2 ** (32 - a.prefix);
  const usable = size - reserved;
  const out = [];
  if (a.prefix > minPrefix) out.push(`/${a.prefix} is smaller than the ${provider} minimum /${minPrefix}`);
  else if (usable < a.hostsRequested) out.push(`only ${usable} usable after ${provider} reserves ${reserved}`);
  if (maxPrefix && a.prefix < maxPrefix) out.push(`/${a.prefix} is larger than the ${provider} maximum /${maxPrefix}`);
  return out;
}

function cloudList(plan, { provider, minPrefix, maxPrefix = 0, reserved, head, tail }) {
  const aware =
    plan.provider === provider.toLowerCase() &&
    plan.reservedHosts === reserved &&
    plan.reserveHead === head &&
    plan.reserveTail === tail &&
    plan.minPrefix === minPrefix &&
    plan.maxPrefix === maxPrefix;
  const width = Math.max(...plan.allocations.map((a) => a.cidr.length), 0);
  const bounds = maxPrefix ? `allowed subnet sizes are /${maxPrefix} to /${minPrefix}` : `minimum /${minPrefix}`;
  const lines = [
    `# ${provider} subnet CIDRs for ${formatCidr(plan.parent)}`,
    aware
      ? `# Planned with ${provider} rules: ${reserved} addresses reserved in every subnet, ${bounds}.`
      : `# ${provider} reserves ${reserved} addresses in every subnet; ${bounds}.`,
  ];
  for (const a of plan.allocations) {
    const warnings = capacityWarnings(a, { provider, reserved, minPrefix, maxPrefix });
    let note = `${a.name} (${a.hostsRequested} hosts)`;
    if (warnings.length) note += ` WARNING: ${warnings.join('; ')}`;
    lines.push(`${a.cidr.padEnd(width)}  # ${note}`);
  }
  return lines.join('\n') + '\n';
}

export const planToAWS = (plan) => cloudList(plan, { provider: 'AWS', minPrefix: 28, maxPrefix: 16, reserved: 5, head: 4, tail: 1 });
export const planToAzure = (plan) => cloudList(plan, { provider: 'Azure', minPrefix: 29, reserved: 5, head: 4, tail: 1 });
export const planToGCP = (plan) => cloudList(plan, { provider: 'GCP', minPrefix: 29, reserved: 4, head: 2, tail: 2 });

/** Wildcard mask for a prefix, for ACLs and OSPF network statements. */
const wildcardOf = (prefix) => formatAddress(((1n << 32n) - 1n) ^ prefixToMask(prefix, 4), 4);

/** Cisco OSPF network statements; area IDs are placeholders. */
export function planToOspf(plan) {
  const lines = [
    `! OSPF network statements for ${formatCidr(plan.parent)}`,
    '! Area IDs are placeholders; change them to match your design.',
  ];
  for (const a of plan.allocations) lines.push(`network ${a.network} ${wildcardOf(a.prefix)} area 0`);
  return lines.join('\n') + '\n';
}

/**
 * Cisco extended ACL entries, one per allocated subnet. Extended ACL syntax needs both
 * a source and a destination; the destination defaults to `any` and is called out in
 * the header so it can be replaced with a host or network.
 */
export function planToAcl(plan) {
  const lines = [
    `! Extended ACL entries for ${formatCidr(plan.parent)}`,
    '! Source is each subnet; destination is any. Replace "any" with a host or network as needed.',
  ];
  for (const a of plan.allocations) lines.push(`permit ip ${a.network} ${wildcardOf(a.prefix)} any  ! ${a.name}`);
  return lines.join('\n') + '\n';
}

/** One summary/discard route for the whole parent block. */
export function planToRoute(plan) {
  const net = formatAddress(plan.parent.value, 4);
  const mask = formatAddress(prefixToMask(plan.parent.prefix, 4), 4);
  return `! Summary route for ${formatCidr(plan.parent)}\nip route ${net} ${mask} Null0\n`;
}

const cfnString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function logicalId(name, used) {
  let base = String(name).replace(/[^A-Za-z0-9]/g, '') || 'Subnet';
  if (!/^[A-Za-z]/.test(base)) base = 'S' + base;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}${n++}`;
  used.add(id);
  return id;
}

/** CloudFormation subnet resources; VpcId and AvailabilityZone are references to fill in. */
export function planToCloudFormation(plan) {
  const used = new Set();
  const rule = { provider: 'AWS', reserved: 5, minPrefix: 28, maxPrefix: 16 };
  const lines = [
    `# CloudFormation subnet resources for ${formatCidr(plan.parent)}`,
    '# AWS allows IPv4 subnets from /16 to /28 and reserves the first four and the last address.',
    '# Wire VpcId and AvailabilityZone from your template.',
    'Resources:',
  ];
  for (const a of plan.allocations) {
    const warnings = capacityWarnings(a, rule);
    if (warnings.length) lines.push(`  # WARNING: ${a.name}: ${warnings.join('; ')}`);
    lines.push(`  ${logicalId(a.name, used)}:`);
    lines.push('    Type: AWS::EC2::Subnet');
    lines.push('    Properties:');
    lines.push('      VpcId: !Ref VpcId');
    lines.push('      AvailabilityZone: !Ref AvailabilityZone');
    lines.push(`      CidrBlock: ${a.cidr}`);
    lines.push('      Tags:');
    lines.push('        - Key: Name');
    lines.push(`          Value: ${cfnString(a.name)}`);
  }
  return lines.join('\n') + '\n';
}

// Bicep escapes reserved characters with a backslash: \\, \' and \${ (only before "{").
const bicepText = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$\{/g, '\\${');

function bicepId(name, used) {
  let base = String(name).replace(/[^A-Za-z0-9_]/g, '_') || 'subnet';
  if (!/^[A-Za-z_]/.test(base)) base = 's_' + base;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}${n++}`;
  used.add(id);
  return id;
}

/** Bicep subnet resources for an existing virtual network. */
export function planToBicep(plan) {
  const used = new Set();
  const rule = { provider: 'Azure', reserved: 5, minPrefix: 29 };
  const lines = [
    `// Bicep subnet resources for ${formatCidr(plan.parent)}`,
    '// Azure reserves the first four and the last address and does not allow subnets smaller than /29.',
    '// Attach each subnet to an existing virtual network.',
    'param vnetName string',
    '',
  ];
  for (const a of plan.allocations) {
    const warnings = capacityWarnings(a, rule);
    if (warnings.length) lines.push(`// WARNING: ${a.name}: ${warnings.join('; ')}`);
    lines.push(`resource ${bicepId(a.name, used)} 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' = {`);
    lines.push(`  name: '\${vnetName}/${bicepText(a.name)}'`);
    lines.push('  properties: {');
    lines.push(`    addressPrefix: '${bicepText(a.cidr)}'`);
    lines.push('  }');
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

/** Ticket-ready plan text: requests in, allocation rule, allocations and free space. */
export function planToText(plan) {
  const total = plan.usedAddresses + plan.freeAddresses;
  const provider = plan.provider && plan.reservedHosts !== 2 ? `${plan.provider} capacity rule` : null;
  const rule = provider
    ? `Rule: largest request first, each block aligned to its own size; ${provider} reserves ${plan.reservedHosts} addresses per subnet (${plan.reserveHead} at the start, ${plan.reserveTail} at the end) with a minimum /${plan.minPrefix}.`
    : 'Rule: largest request first, each block aligned to its own size; 2-host links get a /30 unless /31 is enabled, and 1-host requests get a /30 unless /32 is enabled.';
  const lines = [`VLSM plan for ${formatCidr(plan.parent)}`, rule, '', 'Requests:'];
  for (const a of plan.allocations) lines.push(`  ${a.name} ${str(a.hostsRequested)}`);
  lines.push('', 'Allocations:');
  for (const a of plan.allocations) {
    const broadcast = a.broadcast ? `, broadcast ${a.broadcast}` : ', no broadcast (RFC 3021)';
    lines.push(
      `  ${a.name} -> ${a.cidr} (${a.firstHost} - ${a.lastHost}${broadcast}; ${str(a.usableHosts)} usable, ${str(a.wasted)} unused)`,
    );
  }
  lines.push(
    '',
    `Free: ${plan.free.length ? plan.free.map(formatCidr).join(', ') : 'none'}`,
    `Summary: ${plan.allocations.length} subnets, ${str(plan.usedAddresses)} of ${str(total)} addresses allocated, ${str(plan.freeAddresses)} free.`,
    'Computed with SubnetCalc (https://subnetcalc.dev) - all arithmetic runs in the browser.',
  );
  return lines.join('\n') + '\n';
}

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
