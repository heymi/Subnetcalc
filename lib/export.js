// subnetcalc export formatters. MIT License. https://subnetcalc.dev
//
// Turns results from lib/subnet.js into text for the clipboard or a download.
// No math here: everything is read from the objects subnet.js returns.

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
