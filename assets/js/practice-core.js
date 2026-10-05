// Seeded subnetting questions. Every answer comes from lib/subnet.js.
import { analyze, maskToPrefix, networkOf, parseAddress, parseCidr, requiredPrefix } from '../../lib/subnet.js';
import { esc, group } from './ui.js';

export const QUESTION_TYPES = ['network', 'prefix-mask', 'mask-prefix', 'hosts', 'magic'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const STATS_KEY = 'subnetcalc.practice.stats';
export const EMPTY_STATS = { correct: 0, answered: 0, streak: 0, best: 0 };

const HOSTS = {
  easy: [2, 6, 10, 14, 20, 30, 50, 62, 100, 126, 200, 254],
  medium: [300, 510, 1000, 2000, 4000, 8000, 16000, 32766, 65534],
  hard: [70000, 100000, 131070, 200000, 500000, 1000000],
};

/** Fixed drills rendered into the page. Numbers are filled by buildQuestion. */
export const FIXED_SPECS = [
  { type: 'network', difficulty: 'easy', prefix: 26, octets: [192, 168, 1, 37] },
  { type: 'prefix-mask', difficulty: 'easy', prefix: 27, octets: [10, 0, 0, 0] },
  { type: 'mask-prefix', difficulty: 'easy', prefix: 25, octets: [192, 168, 0, 20] },
  { type: 'hosts', difficulty: 'easy', hosts: 50 },
  { type: 'magic', difficulty: 'easy', prefix: 26, octets: [172, 16, 5, 40] },
  { type: 'magic', difficulty: 'medium', prefix: 22, octets: [10, 1, 4, 77] },
  { type: 'network', difficulty: 'medium', prefix: 20, octets: [172, 20, 19, 5] },
  { type: 'network', difficulty: 'hard', prefix: 31, octets: [192, 168, 10, 7] },
  { type: 'network', difficulty: 'hard', prefix: 32, octets: [10, 0, 0, 5] },
  { type: 'magic', difficulty: 'hard', prefix: 12, octets: [10, 40, 15, 9] },
];

const NONE = new Set(['none', 'n/a', 'na', '-', '--', '—', 'no', 'nobroadcast', 'no broadcast']);

export function mixSeed(seed, index, extra) {
  const s = `${seed}|${index}|${extra}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function addOffset(octets, offset) {
  let v = octets.reduce((n, x) => n * 256 + x, 0) + offset;
  const out = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function mustAnalyze(input) {
  const result = analyze(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.info;
}

/** Interesting-octet block size: 256 minus that mask octet. */
export function magicOf(info) {
  const mask = info.netmask.split('.').map(Number);
  const addr = info.address.split('.').map(Number);
  let index = mask.findIndex((v) => v !== 255);
  if (index === -1) index = 3;
  const value = mask[index];
  const block = value === 255 ? 1 : 256 - value;
  const start = Math.floor(addr[index] / block) * block;
  const net = addr.slice();
  net[index] = start;
  for (let i = index + 1; i < 4; i++) net[i] = 0;
  return { index, value, block, addr: addr[index], start, network: net.join('.') };
}

function magicLines(info) {
  const m = magicOf(info);
  const lines = [
    `Mask ${info.netmask}. The interesting octet is octet ${m.index + 1}, value ${m.value}.`,
    `Block size = 256 − ${m.value} = ${m.block}. Subnets in that octet start on multiples of ${m.block}.`,
    `Address octet ${m.addr} falls in the block that starts at ${m.start}.`,
  ];
  if (m.index < 3) {
    lines.push(`Octets after octet ${m.index + 1} are 0 in the network address and 255 in the broadcast address.`);
  }
  if (info.prefix === 32) {
    lines.push(`A /32 is the single address ${info.network}. There is no broadcast address.`);
  } else if (info.prefix === 31) {
    lines.push(
      `The network is ${info.network}. A /31 has no broadcast address: ${info.firstHost} and ${info.lastHost} are both usable (RFC 3021).`,
    );
  } else {
    lines.push(
      `Network ${info.network}, broadcast ${info.broadcast}. Usable hosts run from ${info.firstHost} to ${info.lastHost} (${group(info.usableHosts)} of ${group(info.totalAddresses)}).`,
    );
  }
  return lines;
}

function hostsExplain(hosts, prefix, info, smaller) {
  const lines = [
    `${group(hosts)} usable hosts are required, and the network and broadcast addresses are reserved.`,
    `The smallest prefix lib/subnet.js returns for that count is /${prefix} (${info.netmask}), with ${group(info.usableHosts)} usable hosts.`,
  ];
  if (smaller && BigInt(smaller.usableHosts) < BigInt(hosts)) {
    lines.push(
      `/${prefix + 1} has ${group(smaller.usableHosts)} usable hosts, which is short of ${group(hosts)}, so /${prefix} is the smallest that fits.`,
    );
  }
  return lines;
}

/**
 * @param {{ type: string, difficulty?: string, prefix?: number, octets?: number[], hosts?: number }} spec
 */
export function buildQuestion(spec) {
  const difficulty = spec.difficulty || 'easy';
  if (spec.type === 'hosts') {
    const hosts = spec.hosts;
    const prefix = requiredPrefix(hosts);
    const info = mustAnalyze(`10.0.0.0/${prefix}`);
    const smaller = prefix < 32 ? mustAnalyze(`10.0.0.0/${prefix + 1}`) : null;
    return {
      type: 'hosts',
      difficulty,
      prefix,
      hosts,
      prompt: `A subnet needs ${group(hosts)} usable hosts. What is the smallest prefix length? Reserve the network and broadcast addresses.`,
      fields: [{ name: 'prefix', label: 'Prefix length', placeholder: '/26' }],
      answers: { prefix: `/${prefix}` },
      explain: hostsExplain(hosts, prefix, info, smaller),
    };
  }

  const ip = spec.octets.join('.');
  const info = mustAnalyze(`${ip}/${spec.prefix}`);
  const base = { type: spec.type, difficulty, prefix: info.prefix, address: info.address, mask: info.netmask };

  if (spec.type === 'prefix-mask') {
    return {
      ...base,
      prompt: `What is the subnet mask for /${info.prefix}, and how many usable hosts does it have?`,
      fields: [
        { name: 'mask', label: 'Subnet mask', placeholder: '255.255.255.0' },
        { name: 'usable', label: 'Usable hosts', placeholder: '254' },
      ],
      answers: { mask: info.netmask, usable: group(info.usableHosts) },
      explain: [
        `/${info.prefix} is ${info.netmask}.`,
        info.prefix >= 31
          ? `/${info.prefix} does not reserve a network and broadcast address, so usable hosts = ${group(info.usableHosts)}.`
          : `Total addresses ${group(info.totalAddresses)}, minus the network and broadcast addresses, leaves ${group(info.usableHosts)} usable hosts.`,
      ],
    };
  }

  if (spec.type === 'mask-prefix') {
    const prefix = maskToPrefix(info.netmask, 4);
    return {
      ...base,
      prompt: `The subnet mask is ${info.netmask}. What prefix length is that?`,
      fields: [{ name: 'prefix', label: 'Prefix length', placeholder: '/24' }],
      answers: { prefix: `/${prefix}` },
      explain: [`${info.netmask} has ${prefix} leading one-bits, so the prefix is /${prefix}.`],
    };
  }

  if (spec.type === 'magic') {
    return {
      ...base,
      prompt: `Which subnet contains ${info.address} with mask ${info.netmask}? Give the network in CIDR notation.`,
      fields: [{ name: 'cidr', label: 'Network', placeholder: '192.168.1.0/26' }],
      answers: { cidr: info.cidr },
      explain: [...magicLines(info), `The subnet is ${info.cidr}.`],
    };
  }

  return {
    ...base,
    type: 'network',
    prompt: `For ${info.address}/${info.prefix}, give the network address, broadcast address, first usable host and last usable host. Write none when there is no broadcast address.`,
    fields: [
      { name: 'network', label: 'Network address', placeholder: '192.168.1.0' },
      { name: 'broadcast', label: 'Broadcast address', placeholder: '192.168.1.63' },
      { name: 'first', label: 'First usable host', placeholder: '192.168.1.1' },
      { name: 'last', label: 'Last usable host', placeholder: '192.168.1.62' },
    ],
    answers: {
      network: info.network,
      broadcast: info.broadcast ?? 'none',
      first: info.firstHost,
      last: info.lastHost,
    },
    explain: magicLines(info),
  };
}

function pickPrefix(rng, difficulty) {
  if (difficulty === 'easy') return randInt(rng, 24, 30);
  if (difficulty === 'medium') return randInt(rng, 16, 23);
  if (rng() < 0.34) return rng() < 0.5 ? 31 : 32;
  return randInt(rng, 8, 15);
}

function pickOctets(rng, prefix) {
  let o0;
  let o1;
  if (prefix >= 24) {
    o0 = 192;
    o1 = 168;
  } else if (prefix >= 16) {
    if (rng() < 0.5) {
      o0 = 10;
      o1 = randInt(rng, 0, 255);
    } else {
      o0 = 172;
      o1 = randInt(rng, 16, 31);
    }
  } else if (rng() < 0.25 && prefix >= 12) {
    o0 = 172;
    o1 = randInt(rng, 16, 31);
  } else {
    o0 = 10;
    o1 = randInt(rng, 0, 255);
  }
  const rough = [o0, o1, randInt(rng, 0, 255), randInt(rng, 0, 255)];
  const net = mustAnalyze(`${rough.join('.')}/${prefix}`).network.split('.').map(Number);
  const span = 2 ** (32 - prefix);
  let offset = 0;
  if (span === 2) offset = randInt(rng, 0, 1);
  else if (span > 2) offset = 1 + Math.floor(rng() * (span - 1));
  return addOffset(net, offset);
}

/** Question `index` of the set identified by `seed`, filters included. */
export function makeQuestion({ seed, index = 0, types = QUESTION_TYPES, difficulty = 'easy' }) {
  if (!types.length) throw new Error('Pick at least one question type');
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`Unknown difficulty ${difficulty}`);
  const allowed = types.filter((t) => QUESTION_TYPES.includes(t));
  const key = [...allowed].sort().join(',');
  const rng = mulberry32(mixSeed(String(seed), index, `${difficulty}|${key}`));
  const type = allowed[randInt(rng, 0, allowed.length - 1)];
  if (type === 'hosts') {
    const list = HOSTS[difficulty];
    return buildQuestion({ type, difficulty, hosts: list[randInt(rng, 0, list.length - 1)] });
  }
  const prefix = pickPrefix(rng, difficulty);
  return buildQuestion({ type, difficulty, prefix, octets: pickOctets(rng, prefix) });
}

function isNone(s) {
  return NONE.has(String(s).trim().toLowerCase().replace(/\./g, ''));
}

function sameAddress(a, b) {
  try {
    const x = parseAddress(String(a).trim());
    const y = parseAddress(String(b).trim());
    return x.version === y.version && x.value === y.value;
  } catch {
    return false;
  }
}

function sameCidr(got, want) {
  try {
    const g = parseCidr(String(got).trim());
    const w = parseCidr(String(want).trim());
    const gn = networkOf(g);
    const wn = networkOf(w);
    // The written address has to be the network address, not a host inside it.
    return g.value === gn.value && w.value === wn.value && g.prefix === w.prefix && gn.value === wn.value;
  } catch {
    return false;
  }
}

function digits(s) {
  const t = String(s).trim().replace(/,/g, '').replace(/\s+/g, '');
  if (!/^\d+$/.test(t)) return null;
  return t.replace(/^0+(?=\d)/, '');
}

function matchField(name, got, want) {
  const value = String(got ?? '').trim();
  if (!value) return false;
  if (name === 'broadcast' && want === 'none') return isNone(value);
  if (name === 'prefix') {
    const m = value.match(/^\/?(\d{1,2})$/);
    const w = String(want).match(/^\/?(\d{1,2})$/);
    return !!m && !!w && Number(m[1]) === Number(w[1]);
  }
  if (name === 'usable') return digits(value) !== null && digits(value) === digits(want);
  if (name === 'cidr') return sameCidr(value, want);
  if (name === 'mask' || name === 'network' || name === 'broadcast' || name === 'first' || name === 'last') {
    return sameAddress(value, want);
  }
  return value === String(want);
}

/** Grade a submitted answer object. `blank` is not recorded as an attempt. */
export function grade(question, input) {
  const fields = {};
  let ok = true;
  let blank = true;
  for (const f of question.fields) {
    const got = String(input?.[f.name] ?? '');
    if (got.trim()) blank = false;
    const pass = matchField(f.name, got, question.answers[f.name]);
    fields[f.name] = { pass, want: question.answers[f.name] };
    if (!pass) ok = false;
  }
  return { ok: ok && !blank, blank, fields };
}

export function readStats(storage) {
  try {
    if (!storage) return { ...EMPTY_STATS };
    const raw = storage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    const s = JSON.parse(raw);
    const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
    return { correct: n(s.correct), answered: n(s.answered), streak: n(s.streak), best: n(s.best) };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function recordAnswer(storage, correct) {
  const s = readStats(storage);
  s.answered += 1;
  if (correct) {
    s.correct += 1;
    s.streak += 1;
    if (s.streak > s.best) s.best = s.streak;
  } else s.streak = 0;
  try {
    storage?.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* private mode or a full quota: the score still shows for this page view */
  }
  return s;
}

export function formatStats(s) {
  const pct = s.answered ? ` · ${Math.round((s.correct / s.answered) * 100)}%` : '';
  return `${s.correct} correct of ${s.answered}${pct} · streak ${s.streak}`;
}

function stepsHtml(lines) {
  return `<ol class="steps">${lines.map((line) => `<li><span>${esc(line)}</span></li>`).join('')}</ol>`;
}

export function practiceDrillsHtml() {
  return FIXED_SPECS.map((spec) => {
    const q = buildQuestion(spec);
    const bits = q.fields
      .map((f) => `${esc(f.label)}: <code>${esc(q.answers[f.name])}</code>`)
      .join(' · ');
    return `<details>
<summary>${esc(q.prompt)}</summary>
<div class="answer"><p>${bits}</p>${stepsHtml(q.explain)}</div>
</details>`;
  }).join('\n');
}

export function magicExampleHtml() {
  const q = buildQuestion({ type: 'magic', difficulty: 'easy', prefix: 26, octets: [192, 168, 1, 77] });
  return `<div class="callout"><p><strong>Example.</strong> ${esc(q.prompt)}</p><p>Answer: <code>${esc(q.answers.cidr)}</code></p>${stepsHtml(q.explain)}</div>`;
}

/** Printable 10-question sheet. The answer list is a later sibling so print CSS can page-break it. */
export function worksheetHtml(questions, { seed, index } = {}) {
  const where = seed != null ? `<p class="meta">Seed ${esc(seed)}, starting at question ${esc(index ?? 0)}.</p>` : '';
  const ask = questions
    .map((q) => {
      const blanks = q.fields.map((f) => `<p>${esc(f.label)}: ________</p>`).join('');
      return `<li><p>${esc(q.prompt)}</p>${blanks}</li>`;
    })
    .join('');
  const answers = questions
    .map((q) => {
      const bits = q.fields.map((f) => `${esc(f.label)}: <code>${esc(q.answers[f.name])}</code>`).join(' · ');
      return `<li><p>${esc(q.prompt)}</p><p>${bits}</p></li>`;
    })
    .join('');
  return `<h2>Practice questions</h2>${where}<ol class="worksheet-qs">${ask}</ol><h2 class="worksheet-answers">Answers</h2><ol>${answers}</ol>`;
}
