// subnetcalc — IPv4/IPv6 subnet math. MIT License. https://subnetcalc.dev
//
// Pure computation and data structures: no DOM, no formatting for export.
// Every address is a BigInt internally (IPv4 too), so both families share one code path.

import SPECIAL from './data/special-purpose.json' with { type: 'json' };

/** @typedef {{ version: 4|6, value: bigint, zone?: string }} Address */
/** @typedef {{ version: 4|6, value: bigint, prefix: number }} Cidr  value keeps host bits as entered */

const BITS = { 4: 32, 6: 128 };
const ALL_ONES = { 4: (1n << 32n) - 1n, 6: (1n << 128n) - 1n };
const MAX_HOSTS_V4 = 2 ** 32 - 2;

export class SubnetError extends Error {
  /**
   * @param {string} code  EMPTY | INCOMPLETE | INVALID_ADDRESS | INVALID_PREFIX | INVALID_MASK |
   *   NON_CONTIGUOUS_MASK | MIXED_VERSION | INSUFFICIENT_SPACE | INVALID_MAC | TOO_MANY |
   *   INVALID_HOSTS | INVALID_RANGE | INVALID_LIMIT | NOT_SUBNET | IPV4_ONLY | INVALID_RESERVATION
   */
  constructor(code, message, input) {
    super(message);
    this.name = 'SubnetError';
    this.code = code;
    this.input = input;
  }
}

const fail = (code, message, input) => {
  throw new SubnetError(code, message, input);
};

// ───────────────────────────── parsing ─────────────────────────────

function parseIPv4(s, input) {
  if (!/^[0-9.]+$/.test(s)) fail('INVALID_ADDRESS', `"${s}" is not a valid IPv4 address`, input);
  const parts = s.split('.');
  if (parts.length > 4) fail('INVALID_ADDRESS', 'An IPv4 address has exactly four octets', input);
  let value = 0n;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === '') {
      if (i === parts.length - 1) break; // trailing dot: still typing
      fail('INVALID_ADDRESS', 'Empty octet in IPv4 address', input);
    }
    if (p.length > 1 && p[0] === '0') {
      fail('INVALID_ADDRESS', `Octet "${p}" has a leading zero (ambiguous: octal or decimal?)`, input);
    }
    const n = Number(p);
    if (n > 255) fail('INVALID_ADDRESS', `Octet ${p} is out of range (0–255)`, input);
    value = (value << 8n) | BigInt(n);
  }
  if (parts.length < 4 || parts[3] === '') fail('INCOMPLETE', 'IPv4 address is incomplete', input);
  return value;
}

function parseIPv6(s, input) {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) fail('INVALID_ADDRESS', `"${s}" is not a valid IPv6 address`, input);
  if (s.includes(':::')) fail('INVALID_ADDRESS', '":::" is not valid in an IPv6 address', input);
  const dbl = s.split('::').length - 1;
  if (dbl > 1) fail('INVALID_ADDRESS', '"::" may appear only once in an IPv6 address', input);
  if (s.startsWith(':') && !s.startsWith('::')) fail('INVALID_ADDRESS', 'IPv6 address cannot start with a single ":"', input);
  if (s.endsWith(':') && !s.endsWith('::')) fail('INCOMPLETE', 'IPv6 address is incomplete', input);

  const groupsOf = (part) => (part === '' ? [] : part.split(':'));
  let head, tail;
  if (dbl) [head, tail] = s.split('::').map(groupsOf);
  else [head, tail] = [groupsOf(s), []];

  // Embedded dotted IPv4 in the last group (e.g. ::ffff:192.0.2.1) counts as two groups.
  const words = [];
  const last = dbl ? tail : head; // dotted IPv4 is only allowed as the final group
  let v4tail = null;
  if (last.length && last[last.length - 1].includes('.')) {
    v4tail = parseIPv4(last.pop(), input);
  }
  for (const g of [...head, ...tail]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) fail('INVALID_ADDRESS', `"${g}" is not a valid IPv6 group (1–4 hex digits)`, input);
  }
  const count = head.length + tail.length + (v4tail === null ? 0 : 2);
  if (dbl ? count > 7 : count > 8) fail('INVALID_ADDRESS', 'Too many groups in IPv6 address', input);
  if (!dbl && count < 8) fail('INCOMPLETE', 'IPv6 address is incomplete', input);

  for (const g of head) words.push(parseInt(g, 16));
  for (let i = 0; i < 8 - count; i++) words.push(0);
  for (const g of tail) words.push(parseInt(g, 16));
  let value = 0n;
  for (const w of words) value = (value << 16n) | BigInt(w);
  if (v4tail !== null) value = (value << 32n) | v4tail;
  return value;
}

/**
 * Parse a single address. IPv4 rejects leading zeros; IPv6 accepts every RFC 4291 form,
 * embedded dotted IPv4 and a %zone suffix.
 * @returns {Address}
 */
export function parseAddress(str) {
  const input = str;
  const s = String(str ?? '').trim();
  if (s === '') fail('EMPTY', 'Enter an IP address', input);
  // "192", "2001", "fe80": could still become either family while the user types.
  if (/^[0-9a-fA-F]{1,4}$/.test(s)) fail('INCOMPLETE', 'Address is incomplete', input);
  if (s.includes(':') || s.includes('%')) {
    const pct = s.indexOf('%');
    const body = pct === -1 ? s : s.slice(0, pct);
    const zone = pct === -1 ? undefined : s.slice(pct + 1);
    if (zone === '') fail('INCOMPLETE', 'Zone ID after "%" is missing', input);
    if (zone !== undefined && !/^[^\s%/]+$/.test(zone)) fail('INVALID_ADDRESS', `Invalid zone ID "${zone}"`, input);
    if (!body.includes(':')) fail('INVALID_ADDRESS', 'Zone IDs are only valid on IPv6 addresses', input);
    const a = { version: 6, value: parseIPv6(body, input) };
    if (zone !== undefined) a.zone = zone;
    return a;
  }
  return { version: 4, value: parseIPv4(s, input) };
}

const isContiguousMask = (m, version) => {
  const inv = ~m & ALL_ONES[version];
  return (inv & (inv + 1n)) === 0n;
};

/**
 * Full parse with metadata, used by analyze().
 * @param {string} str
 * @param {{ maskAs?: 'mask'|'wildcard' }} [opts]  only consulted when the dotted value is ambiguous
 */
function parseInput(str, opts = {}) {
  const input = str;
  const s = String(str ?? '').trim();
  if (s === '') fail('EMPTY', 'Enter an IP address or CIDR block', input);

  let addrPart = s;
  let maskPart;
  let sep;
  const slash = s.indexOf('/');
  if (slash !== -1) {
    addrPart = s.slice(0, slash).trim();
    maskPart = s.slice(slash + 1).trim();
    sep = '/';
    if (maskPart.includes('/')) fail('INVALID_PREFIX', 'Only one "/" is allowed', input);
  } else if (/\s/.test(s)) {
    const parts = s.split(/\s+/);
    if (parts.length > 2) fail('INVALID_MASK', 'Expected "address mask"', input);
    [addrPart, maskPart] = parts;
    sep = ' ';
  }

  const addr = parseAddress(addrPart);
  const bits = BITS[addr.version];
  const out = { addr, prefix: bits, interpretedAs: null, maskAmbiguous: false, prefixImplied: false };

  if (maskPart === undefined) {
    out.prefixImplied = true;
    return out;
  }
  if (maskPart === '') fail('INCOMPLETE', sep === '/' ? 'Prefix length is missing' : 'Mask is missing', input);

  if (/^[0-9]{1,3}$/.test(maskPart)) {
    const p = Number(maskPart);
    if (p > bits) fail('INVALID_PREFIX', `Prefix /${p} is out of range (0–${bits})`, input);
    out.prefix = p;
    return out;
  }
  if (!maskPart.includes('.')) {
    fail(sep === '/' ? 'INVALID_PREFIX' : 'INVALID_MASK', `"${maskPart}" is not a valid prefix length or mask`, input);
  }
  if (addr.version === 6) fail('INVALID_MASK', 'IPv6 uses prefix lengths (/64), not dotted masks', input);

  let m;
  try {
    m = parseIPv4(maskPart, input);
  } catch (e) {
    if (e.code === 'INCOMPLETE') throw e;
    fail('INVALID_MASK', `"${maskPart}" is not a valid mask`, input);
  }
  const w = ~m & ALL_ONES[4];
  const asMask = isContiguousMask(m, 4);
  const asWildcard = isContiguousMask(w, 4);
  out.maskAmbiguous = asMask && asWildcard; // only 0.0.0.0 and 255.255.255.255
  let mask;
  if (out.maskAmbiguous && opts.maskAs === 'wildcard') {
    out.interpretedAs = 'wildcard';
    mask = w;
  } else if (asMask) {
    out.interpretedAs = 'mask';
    mask = m;
  } else if (asWildcard) {
    out.interpretedAs = 'wildcard';
    mask = w;
  } else {
    fail(
      'NON_CONTIGUOUS_MASK',
      `"${maskPart}" is neither a contiguous netmask nor a wildcard mask. Cisco ACLs also accept non-contiguous wildcards, but those do not describe a CIDR prefix`,
      input,
    );
  }
  out.prefix = popcount(mask);
  return out;
}

/**
 * Parse "a/p", "a/255.255.255.0", "a 255.255.255.0", "a 0.0.0.255" (wildcard) or "a" (= /32, /128).
 * @param {string} str
 * @param {{ maskAs?: 'mask'|'wildcard' }} [opts]
 * @returns {Cidr}
 */
export function parseCidr(str, opts) {
  const r = parseInput(str, opts);
  return { version: r.addr.version, value: r.addr.value, prefix: r.prefix };
}

// Accept a Cidr object or anything parseCidr accepts.
function toCidr(x) {
  if (x && typeof x === 'object' && typeof x.value === 'bigint') {
    return { version: x.version, value: x.value, prefix: x.prefix ?? BITS[x.version] };
  }
  return parseCidr(x);
}

function toAddress(x) {
  if (x && typeof x === 'object' && typeof x.value === 'bigint') return x;
  return parseAddress(x);
}

// ───────────────────────────── formatting ─────────────────────────────

function formatIPv4(v) {
  return [24n, 16n, 8n, 0n].map((s) => String((v >> s) & 0xffn)).join('.');
}

/**
 * @param {bigint} value
 * @param {4|6} version
 * @param {{ expanded?: boolean }} [opts]  IPv6 only: full 8×4 hex digits instead of RFC 5952 form
 */
export function formatAddress(value, version, { expanded = false } = {}) {
  if (version === 4) return formatIPv4(value);
  const words = [];
  for (let i = 7; i >= 0; i--) words.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  if (expanded) return words.map((w) => w.toString(16).padStart(4, '0')).join(':');
  // RFC 5952 §5: IPv4-mapped addresses use mixed notation.
  if (value >> 32n === 0xffffn) return '::ffff:' + formatIPv4(value & 0xffffffffn);
  // RFC 5952 §4.2: compress the longest run (≥ 2) of zero groups, the first one on a tie.
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    if (words[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > bestLen) [best, bestLen] = [i, j - i];
    i = j;
  }
  const hex = words.map((w) => w.toString(16));
  if (best === -1) return hex.join(':');
  return hex.slice(0, best).join(':') + '::' + hex.slice(best + bestLen).join(':');
}

/** @param {Cidr} cidr */
export function formatCidr(cidr) {
  return `${formatAddress(cidr.value, cidr.version)}/${cidr.prefix}`;
}

export function expandIPv6(str) {
  const a = parseAddress(str);
  if (a.version !== 6) fail('INVALID_ADDRESS', 'Not an IPv6 address', str);
  return formatAddress(a.value, 6, { expanded: true });
}

export function compressIPv6(str) {
  const a = parseAddress(str);
  if (a.version !== 6) fail('INVALID_ADDRESS', 'Not an IPv6 address', str);
  return formatAddress(a.value, 6);
}

// ───────────────────────────── masks ─────────────────────────────

function popcount(x) {
  let n = 0;
  for (; x; x &= x - 1n) n++;
  return n;
}

const bitLength = (x) => (x === 0n ? 0 : x.toString(2).length);

function checkPrefix(prefix, version, input = prefix) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > BITS[version]) {
    fail('INVALID_PREFIX', `Prefix /${prefix} is out of range (0–${BITS[version]})`, input);
  }
}

export function prefixToMask(prefix, version) {
  checkPrefix(prefix, version);
  const bits = BITS[version];
  return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

const hostMask = (prefix, version) => ALL_ONES[version] >> BigInt(prefix);

/** @param {bigint|string} mask  a dotted string infers IPv4; a bigint needs `version` */
export function maskToPrefix(mask, version) {
  let m = mask;
  if (typeof mask === 'string') {
    const a = parseAddress(mask);
    m = a.value;
    version = version ?? a.version;
  }
  if (!isContiguousMask(m, version)) fail('NON_CONTIGUOUS_MASK', `${mask} is not a contiguous mask`, mask);
  return popcount(m);
}

/** @param {Cidr|string} cidr  @returns {Cidr} the same block with host bits cleared */
export function networkOf(cidr) {
  const c = toCidr(cidr);
  return { version: c.version, value: c.value & prefixToMask(c.prefix, c.version), prefix: c.prefix };
}

const lastOf = (c) => (c.value & prefixToMask(c.prefix, c.version)) | hostMask(c.prefix, c.version);
const sizeOf = (c) => 1n << BigInt(BITS[c.version] - c.prefix);

// ───────────────────────────── special-purpose registry ─────────────────────────────

const SPECIAL_BLOCKS = [...SPECIAL.ipv4, ...SPECIAL.ipv6, ...SPECIAL.supplementary].map((e) => ({
  net: networkOf(parseCidr(e.block)),
  entry: { block: e.block, name: e.name, rfc: e.rfc, globallyReachable: e.globallyReachable },
}));

// Most specific block that contains the address or network being classified.
function mostSpecific(table, net) {
  let best = null;
  for (const row of table) {
    if (row.net.version === net.version && contains(row.net, net) && (!best || row.net.prefix > best.net.prefix)) {
      best = row;
    }
  }
  return best;
}

// IPv6 address types: RFC 4291 §2.4 plus well-known blocks from the special-purpose registry.
const V6_TYPES = [
  ['::/128', 'unspecified'],
  ['::1/128', 'loopback'],
  ['::ffff:0:0/96', 'ipv4-mapped'],
  ['64:ff9b::/96', 'nat64'],
  ['100::/64', 'discard'],
  ['2001::/32', 'teredo'],
  ['2001:db8::/32', 'documentation'],
  ['3fff::/20', 'documentation'],
  ['2002::/16', '6to4'],
  ['fc00::/7', 'ULA'],
  ['fe80::/10', 'link-local'],
  ['fec0::/10', 'site-local'],
  ['ff00::/8', 'multicast'],
  ['2000::/3', 'GUA'],
  ['::/8', 'reserved'],
].map(([b, type]) => ({ net: parseCidr(b), type }));

function ipv4Class(value) {
  const o = Number(value >> 24n);
  return o < 128 ? 'A' : o < 192 ? 'B' : o < 224 ? 'C' : o < 240 ? 'D' : 'E';
}

function embeddedIPv4(type, v) {
  const v4 = (x) => formatIPv4(x & 0xffffffffn);
  switch (type) {
    case 'teredo': // RFC 4380 §4: server, flags, obfuscated port and client
      return {
        kind: 'teredo',
        server: v4(v >> 64n),
        client: v4(~v),
        port: Number(((v >> 32n) & 0xffffn) ^ 0xffffn),
        flags: Number((v >> 48n) & 0xffffn),
      };
    case '6to4': // RFC 3056 §2
      return { kind: '6to4', ipv4: v4(v >> 80n) };
    case 'ipv4-mapped': // RFC 4291 §2.5.5.2
      return { kind: 'ipv4-mapped', ipv4: v4(v) };
    case 'nat64': // RFC 6052 §2.2, /96 well-known prefix
      return { kind: 'nat64', ipv4: v4(v) };
    default:
      return null;
  }
}

// ───────────────────────────── analyze ─────────────────────────────

/**
 * Everything the calculator shows for one input. Never throws on bad input.
 * @param {string} input
 * @param {{ maskAs?: 'mask'|'wildcard' }} [opts]
 * @returns {{ ok: true, info: object } | { ok: false, error: { code: string, message: string } }}
 */
export function analyze(input, opts) {
  let r;
  try {
    r = parseInput(input, opts);
  } catch (e) {
    if (e instanceof SubnetError) return { ok: false, error: { code: e.code, message: e.message } };
    throw e;
  }
  const { addr, prefix } = r;
  const { version } = addr;
  const parsed = { version, value: addr.value, prefix };
  const net = networkOf(parsed);
  const last = lastOf(parsed);
  const total = sizeOf(parsed);
  const fmt = (v) => formatAddress(v, version);

  let first = net.value;
  let lastHost = last;
  let broadcast = null;
  let usable = total;
  if (version === 4) {
    if (prefix === 32) usable = 1n;
    else if (prefix === 31) usable = 2n; // RFC 3021: both addresses usable, no broadcast
    else {
      first = net.value + 1n;
      lastHost = last - 1n;
      broadcast = fmt(last);
      usable = total - 2n;
    }
  }
  // IPv6: no broadcast; every address counts as usable, first host is the network address.

  // Classification describes the entered address; a broad subnet can span several scopes.
  const singleAddress = { version, value: addr.value, prefix: BITS[version] };
  const special = mostSpecific(SPECIAL_BLOCKS, singleAddress);
  const info = {
    version,
    input,
    parsed,
    address: fmt(addr.value) + (addr.zone ? `%${addr.zone}` : ''),
    prefix,
    prefixImplied: r.prefixImplied,
    interpretedAs: r.interpretedAs,
    maskAmbiguous: r.maskAmbiguous,
    hostBitsSet: addr.value !== net.value,
    network: fmt(net.value),
    cidr: formatCidr(net),
    broadcast,
    netmask: fmt(prefixToMask(prefix, version)),
    wildcard: fmt(hostMask(prefix, version)),
    firstHost: fmt(first),
    lastHost: fmt(lastHost),
    totalAddresses: total,
    usableHosts: usable,
    ipClass: null,
    classfulPrefix: null,
    special: special ? { ...special.entry } : null,
    ipv6Type: null,
    embedded: null,
    slash64: null,
    slash64Count: null,
  };
  if (version === 4) {
    info.ipClass = ipv4Class(addr.value);
    info.classfulPrefix = { A: 8, B: 16, C: 24 }[info.ipClass] ?? null;
  } else {
    info.ipv6Type = mostSpecific(V6_TYPES, singleAddress)?.type ?? null;
    info.embedded = embeddedIPv4(info.ipv6Type, addr.value);
    if (prefix >= 64) info.slash64 = formatCidr(networkOf({ version: 6, value: addr.value, prefix: 64 }));
    else info.slash64Count = 1n << BigInt(64 - prefix);
  }
  return { ok: true, info };
}

/**
 * Bit-by-bit view for the binary breakdown panel.
 * @param {Cidr|string} cidr
 * @returns {{ address: Bit[], mask: Bit[], network: Bit[] }}
 *   Bit = { index (0 = most significant), bit: 0|1, isNetwork, group (octet/hextet), weight within group }
 */
export function binaryBreakdown(cidr) {
  const c = toCidr(cidr);
  const bits = BITS[c.version];
  const g = c.version === 4 ? 8 : 16;
  const mask = prefixToMask(c.prefix, c.version);
  const row = (v) =>
    Array.from({ length: bits }, (_, i) => ({
      index: i,
      bit: Number((v >> BigInt(bits - 1 - i)) & 1n),
      isNetwork: i < c.prefix,
      group: Math.floor(i / g),
      weight: 2 ** (g - 1 - (i % g)),
    }));
  return { address: row(c.value), mask: row(mask), network: row(c.value & mask) };
}

// ───────────────────────────── set operations ─────────────────────────────

/** True when `inner` (a block or single address) lies entirely inside `outer`. */
export function contains(outer, inner) {
  const a = networkOf(outer);
  const b = toCidr(inner);
  if (a.version !== b.version || b.prefix < a.prefix) return false;
  return (b.value & prefixToMask(a.prefix, a.version)) === a.value;
}

export function overlaps(a, b) {
  const x = networkOf(a);
  const y = networkOf(b);
  return x.version === y.version && (contains(x, y) || contains(y, x));
}

/** Sort order: IPv4 before IPv6, then by network address, then shorter prefix first. */
export function compareCidr(a, b) {
  const x = networkOf(a);
  const y = networkOf(b);
  if (x.version !== y.version) return x.version - y.version;
  if (x.value !== y.value) return x.value < y.value ? -1 : 1;
  return x.prefix - y.prefix;
}

function sameVersion(list, input) {
  const v = list[0]?.version;
  if (list.some((c) => c.version !== v)) fail('MIXED_VERSION', 'Mix of IPv4 and IPv6 is not allowed here', input);
  return v;
}

function rangeToCidrsRaw(lo, hi, version) {
  const bits = BITS[version];
  const out = [];
  while (lo <= hi) {
    const align = lo === 0n ? bits : bitLength(lo & -lo) - 1;
    const fit = bitLength(hi - lo + 1n) - 1;
    const k = Math.min(align, fit);
    out.push({ version, value: lo, prefix: bits - k });
    lo += 1n << BigInt(k);
  }
  return out;
}

/** Smallest list of CIDR blocks covering exactly start..end (inclusive). */
export function rangeToCidrs(start, end) {
  const a = toAddress(start);
  const b = toAddress(end);
  if (a.version !== b.version) fail('MIXED_VERSION', 'Start and end must be the same IP version', `${start} - ${end}`);
  if (a.value > b.value) fail('INVALID_RANGE', 'Start address is after end address', `${start} - ${end}`);
  return rangeToCidrsRaw(a.value, b.value, a.version);
}

/** Merge into the fewest CIDR blocks covering exactly the same addresses (route summarization). */
export function aggregate(list) {
  const nets = list.map(networkOf);
  if (!nets.length) return [];
  const version = sameVersion(nets, list);
  const ranges = nets.map((c) => [c.value, lastOf(c)]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const merged = [];
  for (const [lo, hi] of ranges) {
    const top = merged[merged.length - 1];
    if (top && lo <= top[1] + 1n) {
      if (hi > top[1]) top[1] = hi;
    } else merged.push([lo, hi]);
  }
  return merged.flatMap(([lo, hi]) => rangeToCidrsRaw(lo, hi, version));
}

/** Smallest single block that contains every input. */
export function supernet(list) {
  const nets = list.map(networkOf);
  if (!nets.length) fail('EMPTY', 'Enter at least one network', list);
  const version = sameVersion(nets, list);
  let lo = nets[0].value;
  let hi = lastOf(nets[0]);
  for (const c of nets) {
    if (c.value < lo) lo = c.value;
    const l = lastOf(c);
    if (l > hi) hi = l;
  }
  const prefix = BITS[version] - bitLength(lo ^ hi);
  return networkOf({ version, value: lo, prefix });
}

/**
 * Every overlapping pair. relation describes list[i] relative to list[j].
 * @returns {{ i: number, j: number, relation: 'equal'|'contains'|'contained' }[]}
 */
export function findOverlaps(list) {
  const nets = list.map(networkOf);
  const out = [];
  for (let i = 0; i < nets.length; i++) {
    for (let j = i + 1; j < nets.length; j++) {
      const a = nets[i];
      const b = nets[j];
      if (a.version !== b.version) continue;
      if (a.value === b.value && a.prefix === b.prefix) out.push({ i, j, relation: 'equal' });
      else if (contains(a, b)) out.push({ i, j, relation: 'contains' });
      else if (contains(b, a)) out.push({ i, j, relation: 'contained' });
    }
  }
  return out;
}

/**
 * Divide a block into equal subnets of `newPrefix`.
 * @param {{ limit: number }} opts  an explicit positive integer ceiling is required
 */
export function split(cidr, newPrefix, { limit } = {}) {
  const c = networkOf(cidr);
  if (!Number.isInteger(newPrefix) || newPrefix < c.prefix || newPrefix > BITS[c.version]) {
    fail('INVALID_PREFIX', `New prefix must be between /${c.prefix} and /${BITS[c.version]}`, newPrefix);
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    fail('INVALID_LIMIT', 'Provide an explicit positive integer limit for the subnet list', limit);
  }
  const count = 1n << BigInt(newPrefix - c.prefix);
  if (count > BigInt(limit)) fail('TOO_MANY', `That would create ${count} subnets (limit ${limit})`, newPrefix);
  const step = 1n << BigInt(BITS[c.version] - newPrefix);
  const out = [];
  for (let i = 0n; i < count; i++) out.push({ version: c.version, value: c.value + i * step, prefix: newPrefix });
  return out;
}

/** /0–/32 (or /0–/128) reference table. */
export function prefixTable(version = 4) {
  return Array.from({ length: BITS[version] + 1 }, (_, prefix) => {
    const total = 1n << BigInt(BITS[version] - prefix);
    let usable = total;
    if (version === 4) usable = prefix === 32 ? 1n : prefix === 31 ? 2n : total - 2n;
    return {
      prefix,
      netmask: formatAddress(prefixToMask(prefix, version), version),
      wildcard: formatAddress(hostMask(prefix, version), version),
      totalAddresses: total,
      usableHosts: usable,
    };
  });
}

/**
 * Terraform cidrsubnet(parent, newbits, netnum) arguments that produce `child`.
 * netnum is a Number when it fits in 2^53, otherwise a BigInt.
 */
export function cidrsubnetArgs(parent, child) {
  const p = networkOf(parent);
  const c = networkOf(child);
  if (p.version !== c.version) fail('MIXED_VERSION', 'Parent and child must be the same IP version', child);
  if (!contains(p, c)) fail('NOT_SUBNET', `${formatCidr(c)} is not inside ${formatCidr(p)}`, child);
  const n = (c.value - p.value) >> BigInt(BITS[c.version] - c.prefix);
  return { newbits: c.prefix - p.prefix, netnum: n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n };
}

// ───────────────────────────── VLSM ─────────────────────────────

/**
 * Smallest IPv4 prefix whose usable host count covers `hosts`.
 * Two hosts get a /30 unless allowSlash31 (RFC 3021) is set; one host gets a /30
 * unless allowSlash32 is set (loopback / host route).
 *
 * `reservedHosts` is the number of addresses inside each subnet that cannot be assigned
 * (2 for the classic network + broadcast; 5 for AWS/Azure-style reservations; 4 for GCP).
 * `minPrefix` is the smallest block the platform allows (AWS /28, Azure/GCP /29); the
 * result is widened to it when needed, and /31 and /32 are only offered under the
 * default reservation rule.
 */
export function requiredPrefix(hosts, { allowSlash31 = false, allowSlash32 = false, reservedHosts = 2, minPrefix = 32 } = {}) {
  if (!Number.isInteger(hosts) || hosts < 1 || hosts > MAX_HOSTS_V4) {
    fail('INVALID_HOSTS', `Host count must be a whole number from 1 to ${MAX_HOSTS_V4}`, hosts);
  }
  if (!Number.isInteger(reservedHosts) || reservedHosts < 0 || reservedHosts > 65536) {
    fail('INVALID_RESERVATION', 'Reserved host count must be a whole number from 0 to 65,536', reservedHosts);
  }
  if (!Number.isInteger(minPrefix) || minPrefix < 0 || minPrefix > 32) {
    fail('INVALID_RESERVATION', 'Minimum prefix must be from 0 to 32', minPrefix);
  }
  if (reservedHosts === 2 && minPrefix === 32) {
    if (allowSlash32 && hosts === 1) return 32;
    if (allowSlash31 && hosts <= 2) return 31;
  }
  let hostBits = 0;
  while (2 ** hostBits - reservedHosts < hosts) hostBits++;
  const prefix = 32 - hostBits;
  return prefix > minPrefix ? minPrefix : prefix;
}

/**
 * Allocate subnets for each request, largest first (ties keep input order), packed from the
 * start of the parent block.
 * @param {Cidr|string} parent
 * @param {{ name: string, hosts: number }[]} requests
 * @param {{ allowSlash31?: boolean, reservedHosts?: number, minPrefix?: number, provider?: string }} [opts]
 */
export function planVlsm(parent, requests, opts = {}) {
  try {
    return { ok: true, plan: buildPlan(parent, requests, opts) };
  } catch (e) {
    if (!(e instanceof SubnetError)) throw e;
    const error = { code: e.code, message: e.message };
    if (e.detail) Object.assign(error, e.detail);
    return { ok: false, error };
  }
}

function buildPlan(parentIn, requests, opts) {
  const parent = networkOf(parentIn);
  if (parent.version !== 4) fail('IPV4_ONLY', 'VLSM planning works on IPv4 blocks; split IPv6 by prefix instead', parentIn);
  const reservedHosts = opts.reservedHosts ?? 2;
  const minPrefix = opts.minPrefix ?? 32;
  const rule = { ...opts, reservedHosts, minPrefix };
  const prefixes = requests.map((r) => {
    try {
      return requiredPrefix(r.hosts, rule);
    } catch (e) {
      e.message = `"${r.name}": ${e.message}`;
      throw e;
    }
  });
  const order = requests.map((_, i) => i).sort((a, b) => requests[b].hosts - requests[a].hosts);
  const end = lastOf(parent);
  let cursor = parent.value;
  const allocations = [];
  for (const i of order) {
    const { name, hosts } = requests[i];
    const prefix = prefixes[i];
    const size = 1n << BigInt(32 - prefix);
    // Blocks are placed largest first, so the cursor is always aligned to the current size.
    if (prefix < parent.prefix || cursor + size - 1n > end) {
      const available = end - cursor + 1n;
      const err = new SubnetError(
        'INSUFFICIENT_SPACE',
        `"${name}" needs a /${prefix} (${size} addresses) but only ${available} remain in ${formatCidr(parent)}`,
        parentIn,
      );
      err.detail = { request: name, needed: size, available };
      throw err;
    }
    const block = { version: 4, value: cursor, prefix };
    const last = cursor + size - 1n;
    const p2p = prefix === 31; // RFC 3021: both addresses usable, no broadcast
    const single = prefix === 32; // one host route: the single address is usable
    const usableHosts = single ? 1n : p2p ? 2n : size - BigInt(reservedHosts);
    allocations.push({
      name,
      hostsRequested: hosts,
      prefix,
      network: formatIPv4(cursor),
      cidr: formatCidr(block),
      netmask: formatIPv4(prefixToMask(prefix, 4)),
      firstHost: formatIPv4(p2p || single ? cursor : cursor + 1n),
      lastHost: formatIPv4(p2p || single ? last : last - 1n),
      broadcast: p2p || single ? null : formatIPv4(last),
      usableHosts,
      wasted: usableHosts - BigInt(hosts),
      block,
    });
    cursor += size;
  }
  const usedAddresses = cursor - parent.value;
  return {
    parent,
    allocations,
    free: cursor <= end ? rangeToCidrsRaw(cursor, end, 4) : [],
    usedAddresses,
    freeAddresses: sizeOf(parent) - usedAddresses,
    tree: splitTree(parent, allocations),
    reservedHosts,
    minPrefix,
    provider: opts.provider ?? null,
  };
}

/** Binary split tree for the SVG view: { cidr, state: 'allocated'|'free'|'split', name?, children? } */
function splitTree(cidr, allocations) {
  const hit = allocations.find((a) => a.block.value === cidr.value && a.block.prefix === cidr.prefix);
  if (hit) return { cidr, state: 'allocated', name: hit.name };
  if (!allocations.some((a) => overlaps(a.block, cidr))) return { cidr, state: 'free' };
  const half = 1n << BigInt(BITS[cidr.version] - cidr.prefix - 1);
  const inside = allocations.filter((a) => contains(cidr, a.block));
  const lo = { version: cidr.version, value: cidr.value, prefix: cidr.prefix + 1 };
  const hi = { version: cidr.version, value: cidr.value + half, prefix: cidr.prefix + 1 };
  return { cidr, state: 'split', children: [splitTree(lo, inside), splitTree(hi, inside)] };
}

// ───────────────────────────── IPv6 helpers ─────────────────────────────

function parseMac(mac) {
  const s = String(mac ?? '').trim();
  const ok =
    /^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i.test(s) ||
    /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s) ||
    /^[0-9a-f]{12}$/i.test(s);
  if (!ok) fail('INVALID_MAC', 'Enter a 48-bit MAC address like 00:1a:2b:3c:4d:5e', mac);
  return BigInt('0x' + s.replace(/[^0-9a-f]/gi, ''));
}

// Modified EUI-64 (RFC 4291 Appendix A): insert ff:fe in the middle, flip the U/L bit.
function eui64(mac) {
  const m = parseMac(mac);
  const hi = m >> 24n;
  const lo = m & 0xffffffn;
  return ((hi << 40n) | (0xfffen << 24n) | lo) ^ (0x02n << 56n);
}

/** "00:1a:2b:3c:4d:5e" -> "021a:2bff:fe3c:4d5e" */
export function eui64InterfaceId(mac) {
  const iid = eui64(mac);
  return [48n, 32n, 16n, 0n].map((s) => ((iid >> s) & 0xffffn).toString(16).padStart(4, '0')).join(':');
}

/** SLAAC address from a /64 prefix and a MAC, e.g. ("fe80::/64", mac) -> "fe80::21a:2bff:fe3c:4d5e" */
export function eui64Address(prefix, mac) {
  const c = toCidr(prefix);
  if (c.version !== 6 || c.prefix !== 64) fail('INVALID_PREFIX', 'EUI-64 needs an IPv6 /64 prefix', prefix);
  return formatAddress(networkOf(c).value | eui64(mac), 6);
}

/**
 * Random RFC 4193 ULA /48 (fd00::/8 + 40-bit random Global ID).
 * @param {{ randomBytes?: (n: number) => Uint8Array }} [opts]  injectable for tests
 */
export function generateUla({ randomBytes } = {}) {
  const rand = randomBytes ?? ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const bytes = rand(5);
  const globalId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const value = (0xfdn << 120n) | (BigInt('0x' + globalId) << 80n);
  return { prefix: formatCidr({ version: 6, value, prefix: 48 }), globalId };
}
