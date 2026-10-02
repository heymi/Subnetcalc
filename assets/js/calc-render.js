// HTML renderers for the subnet calculator. Pure functions (string in, string out) so the
// same code fills the page in the browser and pre-renders the default result at build time.
import { binaryBreakdown, formatAddress, prefixToMask } from '../../lib/subnet.js';
import { esc, group, count, sup } from './ui.js';

function row(label, value, { copy = value, sub = '', em = false, html = false } = {}) {
  const v = html ? value : esc(value);
  const btn =
    copy === null
      ? ''
      : `<button type="button" class="copy" data-copy="${esc(copy)}" aria-label="Copy ${esc(label.toLowerCase())}">copy</button>`;
  const main = html ? v : `<span${em ? ' class="em"' : ''}>${v}</span>`;
  return `<div><dt>${esc(label)}</dt><dd>${main}${
    sub ? `<span class="sub">${sub}</span>` : ''
  }</dd><dd class="act">${btn}</dd></div>`;
}

function scopeTag(info) {
  const s = info.special;
  if (s) {
    const reach =
      s.globallyReachable === false
        ? '<span class="tag is-private">not globally reachable</span>'
        : s.globallyReachable === true
          ? '<span class="tag is-public">globally reachable</span>'
          : '';
    return { text: `${s.name} · ${s.rfc}`, html: `<span>${esc(s.name)}</span><span class="sub">${esc(s.rfc)}</span>${reach}` };
  }
  if (info.version === 4 && (info.ipClass === 'D' || info.ipClass === 'E')) return null;
  if (info.version === 4 || info.ipv6Type === 'GUA') {
    return { text: 'Public', html: '<span>Public</span><span class="tag is-public">globally routable</span>' };
  }
  return null;
}

const V6_TYPE_LABEL = {
  GUA: 'Global unicast (GUA)',
  ULA: 'Unique local (ULA)',
  'link-local': 'Link-local',
  'site-local': 'Site-local (deprecated)',
  multicast: 'Multicast',
  loopback: 'Loopback',
  unspecified: 'Unspecified',
  'ipv4-mapped': 'IPv4-mapped',
  nat64: 'NAT64 (well-known prefix)',
  '6to4': '6to4',
  teredo: 'Teredo',
  documentation: 'Documentation',
  discard: 'Discard-only',
  reserved: 'Reserved by IETF',
};

/** The key/value result list. */
export function renderResults(info) {
  const r = [];
  if (info.version === 4) {
    r.push(row('Address', info.address));
    r.push(row('Network', info.cidr, { em: true }));
    r.push(row('Netmask', info.netmask));
    r.push(row('Wildcard', info.wildcard, { sub: 'ACL / OSPF' }));
    if (info.broadcast) r.push(row('Broadcast', info.broadcast));
    else r.push(row('Broadcast', 'none', { sub: info.prefix === 31 ? 'point-to-point, RFC 3021' : 'single host' }));
    r.push(row('First host', info.firstHost));
    r.push(row('Last host', info.lastHost));
    r.push(
      row('Usable hosts', group(info.usableHosts), {
        copy: String(info.usableHosts),
        em: true,
        sub: `of ${group(info.totalAddresses)} addresses`,
      }),
    );
    r.push(row('Prefix', `/${info.prefix}`, { sub: `${info.prefix} network + ${32 - info.prefix} host bits` }));
    r.push(
      row('Class', info.ipClass, {
        sub: info.classfulPrefix ? `classful default /${info.classfulPrefix}` : info.ipClass === 'D' ? 'multicast' : 'reserved',
      }),
    );
    const v = info.parsed.value;
    r.push(row('Integer', String(v), { sub: `0x${v.toString(16).toUpperCase().padStart(8, '0')}` }));
  } else {
    r.push(row('Address', info.address));
    r.push(row('Network', info.cidr, { em: true }));
    r.push(row('Prefix mask', info.netmask));
    r.push(row('Host mask', info.wildcard));
    r.push(row('Prefix', `/${info.prefix}`, { sub: `${info.prefix} network + ${128 - info.prefix} host bits` }));
    r.push(row('First address', info.firstHost));
    r.push(row('Last address', info.lastHost));
    r.push(row('Addresses', count(info.totalAddresses), { copy: String(info.totalAddresses), em: true, sub: 'no broadcast in IPv6' }));
    if (info.slash64) r.push(row('/64 network', info.slash64));
    else r.push(row('/64 subnets', count(info.slash64Count), { copy: String(info.slash64Count) }));
    r.push(row('Expanded', formatAddress(info.parsed.value, 6, { expanded: true })));
  }
  if (info.version === 6 && info.ipv6Type) {
    r.push(row('Type', V6_TYPE_LABEL[info.ipv6Type] || info.ipv6Type));
  }
  const scope = scopeTag(info);
  if (scope) r.push(row('Address scope', scope.html, { copy: scope.text, html: true, sub: 'classification of the entered address' }));
  const e = info.embedded;
  if (e) {
    const val =
      e.kind === 'teredo'
        ? `server ${e.server} · client ${e.client} · port ${e.port}`
        : `${e.ipv4}`;
    r.push(row(e.kind === 'teredo' ? 'Teredo' : `Embedded IPv4`, val, { copy: e.kind === 'teredo' ? e.client : e.ipv4 }));
  }
  return `<dl class="kv">${r.join('')}</dl>`;
}

/** Notices about how the input was read. Each one may carry a button with data-action. */
export function renderNotices(info) {
  const out = [];
  const addr = info.address.split('%')[0];
  if (info.interpretedAs === 'wildcard' && !info.maskAmbiguous) {
    out.push(`Read <strong>${esc(info.input.trim().split(/[\s/]+/)[1])}</strong> as a wildcard mask (ACL style), which is <strong>/${info.prefix}</strong>.`);
  }
  if (info.maskAmbiguous) {
    const m = info.input.trim().split(/[\s/]+/)[1];
    out.push(
      info.interpretedAs === 'mask'
        ? `Read <strong>${esc(m)}</strong> as a netmask (/${info.prefix}). <button type="button" data-action="as-wildcard">Read it as a wildcard instead</button>`
        : `Read <strong>${esc(m)}</strong> as a wildcard (/${info.prefix}). <button type="button" data-action="as-mask">Read it as a netmask instead</button>`,
    );
  }
  if (info.prefixImplied) {
    const single = info.version === 4 ? '/32' : '/128';
    let s = `No prefix given, so this is a single address (${single}).`;
    if (info.classfulPrefix) {
      s += ` <button type="button" data-action="set" data-value="${esc(addr)}/${info.classfulPrefix}">Use the class ${info.ipClass} default /${info.classfulPrefix}</button>`;
    } else if (info.version === 6) {
      s += ` <button type="button" data-action="set" data-value="${esc(addr)}/64">Use /64</button>`;
    }
    out.push(s);
  }
  if (info.hostBitsSet && !info.prefixImplied) {
    out.push(
      `<strong>${esc(addr)}</strong> is a host inside <strong>${esc(info.cidr)}</strong>. <button type="button" data-action="set" data-value="${esc(info.cidr)}">Show the network</button>`,
    );
  }
  return out.map((s) => `<p class="notice">${s}</p>`).join('');
}

function weightSum(byte, width) {
  const parts = [];
  for (let i = width - 1; i >= 0; i--) if (byte & (1 << i)) parts.push(1 << i);
  return parts.length > 1 ? `${byte} = ${parts.join(' + ')}` : String(byte);
}

/** Bit-by-bit breakdown: one block per octet (IPv4) or hextet (IPv6). */
export function renderBinary(info) {
  const b = binaryBreakdown(info.parsed);
  const v6 = info.version === 6;
  const g = v6 ? 16 : 8;
  const groups = v6 ? 8 : 4;
  const rows = [
    ['A', 'address', b.address, true],
    ['M', 'mask', b.mask, !v6],
    ['N', 'network', b.network, !v6],
  ];
  const value = (bits) => bits.reduce((acc, x) => acc * 2 + x.bit, 0);
  let html = '';
  for (let k = 0; k < groups; k++) {
    const slice = (bits) => bits.slice(k * g, k * g + g);
    const addrVal = value(slice(b.address));
    const head = v6
      ? `<span>hextet ${k + 1}</span><b>${addrVal.toString(16).padStart(4, '0')}</b>`
      : `<span>octet ${k + 1}</span><b>${addrVal}</b>`;
    let lines = '';
    for (const [lbl, name, bits, clickable] of rows) {
      const cells = slice(bits)
        .map((x) => {
          const cls = ['bit', x.isNetwork ? 'n' : 'h'];
          if (!x.bit) cls.push('zero');
          if (v6 && x.index % 4 === 0 && x.index % 16 !== 0) cls.push('nib');
          if (x.index === info.prefix - 1 && info.prefix < b.address.length) cls.push('edge');
          return clickable
            ? `<button type="button" class="${cls.join(' ')}" data-i="${x.index}">${x.bit}</button>`
            : `<span class="${cls.join(' ')}" data-i="${x.index}">${x.bit}</span>`;
        })
        .join('');
      lines += `<div class="bitrow" aria-label="${name}"><span class="lbl" aria-hidden="true">${lbl}</span>${cells}</div>`;
    }
    const foot = v6 ? `bits ${k * 16 + 1}–${k * 16 + 16}` : esc(weightSum(addrVal, 8));
    html += `<div class="group"><div class="group-head">${head}</div>${lines}<div class="group-foot">${foot}</div></div>`;
  }
  return `<div class="groups${v6 ? ' v6' : ''}">${html}</div>`;
}

/** Text for the bit detail line when bit `i` is selected. */
export function describeBit(info, i) {
  const b = binaryBreakdown(info.parsed);
  const bits = b.address.length;
  const x = b.address[i];
  const g = info.version === 6 ? 16 : 8;
  const pos = (i % g) + 1;
  const unit = info.version === 6 ? 'hextet' : 'octet';
  const power = g - pos;
  const kind = x.isNetwork ? '<b class="net">network bit</b>' : '<b class="host">host bit</b>';
  return (
    `Bit <b>${i + 1}</b> of ${bits} · ${unit} ${x.group + 1}, position ${pos} · ` +
    `weight in the ${unit}: <b>${group(2 ** power)}</b> (2${sup(power)}) · ` +
    `address bit ${x.bit}, mask bit ${b.mask[i].bit} → ${kind}`
  );
}

/** Worked steps: how the network, broadcast and host count follow from the prefix. */
export function renderSteps(info) {
  const p = info.prefix;
  const li = [];
  if (info.version === 4) {
    const hostBits = 32 - p;
    li.push(`<code>/${p}</code> means ${p} network bits and ${hostBits} host bits (32 in total).`);
    li.push(`Write ${p} ones then ${hostBits} zeros: the netmask is <code>${esc(info.netmask)}</code>.`);
    if (p === 32) {
      li.push('No host bits are left, so the block is one address: a host route.');
    } else if (p === 31) {
      li.push('One host bit gives two addresses. RFC 3021 lets point-to-point links use both, with no broadcast.');
    } else {
      const k = Math.floor(p / 8);
      const octets = info.address.split('.').map(Number);
      const maskOct = info.netmask.split('.').map(Number);
      if (p === 0) {
        li.push('With /0 every bit is a host bit: the block is the whole IPv4 space.');
      } else if (p % 8 === 0) {
        const net = k === 1 ? 'octet 1 is' : `octets 1–${k} are`;
        li.push(`The prefix ends on an octet boundary: ${net} network, the rest is host.`);
      } else {
        const block = 256 - maskOct[k];
        const netOct = Math.floor(octets[k] / block) * block;
        li.push(
          `The interesting octet is octet ${k + 1}, where the mask is <code>${maskOct[k]}</code>. Block size: 256 − ${maskOct[k]} = <code>${block}</code>.`,
        );
        li.push(
          `Network: ${octets[k]} AND ${maskOct[k]} = <code>${netOct}</code> (the largest multiple of ${block} not above ${octets[k]}), so the network is <code>${esc(info.network)}</code>.`,
        );
      }
      li.push(`Broadcast: set every host bit to 1, giving <code>${esc(info.broadcast)}</code>.`);
      li.push(
        `Usable hosts: 2${sup(hostBits)} − 2 = <code>${group(info.usableHosts)}</code>. The network and broadcast addresses are not assigned to hosts.`,
      );
    }
  } else {
    const hostBits = 128 - p;
    li.push(`<code>/${p}</code> keeps the first ${p} bits as the prefix; ${hostBits} bits remain for subnets and interface IDs.`);
    if (p === 0) {
      li.push('With /0 nothing is fixed: the block is the whole IPv6 space.');
    } else if (p === 128) {
      li.push('All 128 bits are fixed: the block is a single address.');
    } else if (p % 16 === 0) {
      const n = p / 16;
      li.push(
        `The boundary falls between hextets ${n} and ${n + 1}: keep the first ${n === 1 ? 'hextet' : `${n} hextets`}, zero the rest → <code>${esc(info.network)}</code>.`,
      );
    } else {
      const k = Math.floor(p / 16);
      const keep = p % 16;
      const nib = formatAddress(prefixToMask(p, 6), 6, { expanded: true }).split(':')[k];
      li.push(
        `The boundary falls inside hextet ${k + 1}: its first ${keep} bits belong to the prefix (mask <code>${nib}</code>). Clear the remaining bits → <code>${esc(info.network)}</code>.`,
      );
    }
    if (p < 128) li.push(`Set all ${hostBits} remaining bits to 1 for the last address: <code>${esc(info.lastHost)}</code>.`);
    if (p === 128) {
      li.push('IPv6 has no broadcast, so the single address is usable.');
    } else if (p <= 64) {
      li.push(`Size: 2${sup(hostBits)} addresses, or ${group(info.slash64Count)} /64 subnet${info.slash64Count === 1n ? '' : 's'} (the standard LAN size).`);
    } else {
      li.push(`Size: 2${sup(hostBits)} = ${group(info.totalAddresses)} addresses. IPv6 has no broadcast, so every address is usable.`);
    }
  }
  return `<ol class="steps">${li.map((s) => `<li><span>${s}</span></li>`).join('')}</ol>`;
}
