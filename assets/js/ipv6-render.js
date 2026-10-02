// Pure renderers for the IPv6 tools page (also used to pre-render the defaults).
import {
  analyze,
  split,
  formatCidr,
  formatAddress,
  networkOf,
  parseCidr,
  eui64InterfaceId,
  eui64Address,
  SubnetError,
} from '../../lib/subnet.js';
import { renderResults } from './calc-render.js';
import { esc, group, count } from './ui.js';

export const DEFAULTS = {
  addr: '2001:db8:abcd:12::1/64',
  split: '2001:db8:abcd::/48',
  newPrefix: 52,
  mac: '00:1a:2b:3c:4d:5e',
  eui: 'fe80::/64',
};
export const SPLIT_SHOW = 256;
const SPLIT_LIMIT = 65536;

const fail = (msg) => `<p class="notice is-error"><strong>Check the input:</strong> ${esc(msg)}.</p>`;

function nibbles(value) {
  return formatAddress(value, 6, { expanded: true }).replace(/:/g, '').split('');
}

/** ip6.arpa name for an address, or the zone for a prefix on a nibble boundary. */
export function reverseName(value, prefix = 128) {
  const n = nibbles(value).slice(0, Math.floor(prefix / 4));
  return [...n.reverse(), 'ip6', 'arpa'].join('.');
}

export function renderAddress(input) {
  const r = analyze(input);
  if (!r.ok) return r.error.code === 'INCOMPLETE' || r.error.code === 'EMPTY' ? null : fail(r.error.message);
  const info = r.info;
  if (info.version !== 6) {
    return `<p class="notice">That is an IPv4 address. <a href="/?q=${esc(encodeURIComponent(info.input.trim()))}">Open it in the subnet calculator</a>.</p>`;
  }
  let html = renderResults(info);
  const v = info.parsed.value;
  const extra = [`<div><dt>Reverse (PTR)</dt><dd><span>${esc(reverseName(v))}</span></dd><dd class="act"><button type="button" class="copy" data-copy="${esc(reverseName(v))}" aria-label="Copy reverse name">copy</button></dd></div>`];
  if (info.prefix % 4 === 0 && info.prefix > 0 && info.prefix < 128) {
    const zone = reverseName(networkOf(info.parsed).value, info.prefix);
    extra.push(
      `<div><dt>Reverse zone</dt><dd><span>${esc(zone)}</span></dd><dd class="act"><button type="button" class="copy" data-copy="${esc(zone)}" aria-label="Copy reverse zone">copy</button></dd></div>`,
    );
  }
  html = html.replace('</dl>', extra.join('') + '</dl>');
  return `${html}<p class="hint" style="margin-top: var(--s3)"><a href="/?q=${esc(info.input.trim())}">Open in the subnet calculator</a> for the bit-by-bit view.</p>`;
}

export function renderSplit(input, newPrefix) {
  let c;
  try {
    c = networkOf(parseCidr(input));
  } catch (e) {
    if (!(e instanceof SubnetError)) throw e;
    return e.code === 'INCOMPLETE' || e.code === 'EMPTY' ? null : fail(e.message);
  }
  const bits = c.version === 4 ? 32 : 128;
  if (!Number.isInteger(newPrefix) || newPrefix <= c.prefix || newPrefix > bits) {
    return fail(`New prefix must be between /${c.prefix + 1} and /${bits}`);
  }
  const total = 1n << BigInt(newPrefix - c.prefix);
  const each = 1n << BigInt(bits - newPrefix);
  let list;
  try {
    list = split(c, newPrefix, { limit: SPLIT_LIMIT });
  } catch (e) {
    if (e.code !== 'TOO_MANY') throw e;
    // too many to list: show the first few by hand
    list = [];
    for (let i = 0n; i < BigInt(SPLIT_SHOW); i++) list.push({ version: c.version, value: c.value + i * each, prefix: newPrefix });
  }
  const shown = list.slice(0, SPLIT_SHOW);
  const all = list.length === Number(total) ? list.map(formatCidr).join('\n') : null;
  return `<div class="row"><span class="k">${esc(formatCidr(c))} → /${newPrefix}</span><span><b>${count(total)}</b> subnets of ${count(each)} addresses</span>${
    all ? `<button type="button" class="copy" data-copy="${esc(all)}">copy all</button>` : ''
  }</div>
<ul>${shown.map((x) => `<li><a href="/?q=${esc(formatCidr(x))}">${esc(formatCidr(x))}</a></li>`).join('')}</ul>${
    total > BigInt(shown.length) ? `<p class="k" style="margin-top: var(--s2)">Showing the first ${shown.length} of ${group(total)}.${all ? '' : ` Lists over ${group(SPLIT_LIMIT)} are not generated.`}</p>` : ''
  }`;
}

export function renderEui(mac, prefix) {
  let iid;
  let addr;
  try {
    iid = eui64InterfaceId(mac);
    addr = eui64Address(prefix, mac);
  } catch (e) {
    if (!(e instanceof SubnetError)) throw e;
    if (e.code === 'INCOMPLETE' || e.code === 'EMPTY') return null;
    return fail(e.message);
  }
  const b = iid.replace(/:/g, '').match(/../g); // 8 bytes of the interface ID
  const orig = [(parseInt(b[0], 16) ^ 2).toString(16).padStart(2, '0'), b[1], b[2], b[5], b[6], b[7]];
  const bin = (h) => parseInt(h, 16).toString(2).padStart(8, '0');
  const flipped = b[0];
  const steps = [
    `MAC address: <code>${orig.join(':')}</code>`,
    `Split it in half: <code>${orig.slice(0, 3).join(':')}</code> | <code>${orig.slice(3).join(':')}</code>`,
    `Insert <code>ff:fe</code> in the middle: <code>${orig.slice(0, 3).join(':')}:<b>ff:fe</b>:${orig.slice(3).join(':')}</code>`,
    `Flip bit 7 (universal/local) of the first byte: <code>${orig[0]}</code> = <code>${bin(orig[0]).slice(0, 6)}<b>${bin(orig[0])[6]}</b>${bin(orig[0])[7]}</code> → <code>${bin(flipped).slice(0, 6)}<b>${bin(flipped)[6]}</b>${bin(flipped)[7]}</code> = <code>${flipped}</code>`,
    `Interface ID: <code>${iid}</code>`,
    `Add the /64 prefix <code>${esc(formatCidr(networkOf(parseCidr(prefix))))}</code>: <b><code>${esc(addr)}</code></b> <button type="button" class="copy" data-copy="${esc(addr)}">copy</button>`,
  ];
  return `<ol class="steps">${steps.map((s) => `<li><span>${s}</span></li>`).join('')}</ol>`;
}

export function renderUla(ula) {
  const base = parseCidr(ula.prefix);
  const sample = [0n, 1n, 2n, 0xffffn].map((i) =>
    formatCidr({ version: 6, value: base.value + (i << 64n), prefix: 64 }),
  );
  return `<div class="row"><b style="font-size: var(--step-1)">${esc(ula.prefix)}</b><button type="button" class="copy" data-copy="${esc(ula.prefix)}">copy</button></div>
<div class="row"><span class="k">Global ID</span><span>${esc(ula.globalId)}</span></div>
<div class="row"><span class="k">/64 subnets</span><span>65,536 (subnet ID 0000–ffff)</span></div>
<div class="row"><span class="k">first /64s</span><span>${sample.slice(0, 3).map((s) => `<a href="/?q=${esc(s)}">${esc(s)}</a>`).join(' ')}</span></div>
<div class="row"><span class="k">last /64</span><span><a href="/?q=${esc(sample[3])}">${esc(sample[3])}</a></span></div>`;
}
