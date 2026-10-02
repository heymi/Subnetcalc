// IPv6 tools page.
import { generateUla, parseCidr, networkOf } from '../../lib/subnet.js';
import { DEFAULTS, renderAddress, renderSplit, renderEui, renderUla, ipv6SummaryText } from './ipv6-render.js';
import { setParams, param, debounce, setStale, copyText, download } from './ui.js';
import { track } from './analytics.js';

const $ = (s) => document.querySelector(s);
const v6 = $('#v6');
const mac = $('#mac');
const euiPrefix = $('#eui-prefix');
const splitIn = $('#split-in');
const splitTo = $('#split-to');

let ula = null;
let dirty = false;
let lastAddrState = null;
let trackTimer;

function validUla(value) {
  try {
    const c = parseCidr(value);
    if (c.version !== 6 || c.prefix !== 48) return null;
    const hex = networkOf(c).value.toString(16).padStart(32, '0');
    return { prefix: value, globalId: hex.slice(2, 12) };
  } catch {
    return null;
  }
}

function currentParams() {
  return {
    q: v6.value !== DEFAULTS.addr ? v6.value.trim() : '',
    mac: mac.value !== DEFAULTS.mac ? mac.value.trim() : '',
    eui: euiPrefix.value !== DEFAULTS.eui ? euiPrefix.value.trim() : '',
    s: splitIn.value !== DEFAULTS.split ? splitIn.value.trim() : '',
    n: Number(splitTo.value) !== DEFAULTS.newPrefix ? splitTo.value : '',
    u: ula ? ula.prefix : '',
  };
}
const flushUrl = () => setParams(currentParams());
const syncUrl = debounce(flushUrl, 300);

function trackAddr(state, code) {
  if (!dirty) return;
  if (state === lastAddrState) return;
  lastAddrState = state;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (state === 'ok') track('calc_done', { tool: 'ipv6' });
    else if (code && code !== 'INCOMPLETE' && code !== 'EMPTY') track('input_error', { tool: 'ipv6', code });
  }, 700);
}

// Results that are null mean "still typing": keep the previous output, dimmed.
function show(el, html) {
  setStale([el], html === null);
  if (html === null) {
    return;
  }
  el.innerHTML = html;
}

function currentSummary() {
  return ipv6SummaryText(
    { addr: v6.value, mac: mac.value, eui: euiPrefix.value, split: splitIn.value, newPrefix: splitTo.value },
    ula,
  );
}

function updateSummaryButton() {
  const b = $('[data-copy-summary]');
  if (b) b.disabled = !currentSummary();
}

const updateAddr = () => {
  const html = renderAddress(v6.value);
  show($('#v6-out'), html);
  syncUrl();
  updateSummaryButton();
  if (html === null) trackAddr('typing');
  else if (html.includes('is-error')) trackAddr('invalid', 'INVALID_ADDRESS');
  else trackAddr('ok');
};
const updateEui = () => {
  show($('#eui-out'), renderEui(mac.value, euiPrefix.value));
  syncUrl();
  updateSummaryButton();
};
const updateSplit = () => {
  show($('#split-out'), renderSplit(splitIn.value, Number(splitTo.value)));
  syncUrl();
  updateSummaryButton();
};

function setUla(value) {
  ula = value;
  $('#ula-out').innerHTML = renderUla(ula);
  updateSummaryButton();
}
const newUla = () => {
  setUla(generateUla());
  flushUrl();
  track('example', { tool: 'ipv6', kind: 'ula' });
};

v6.addEventListener('input', () => {
  dirty = true;
  updateAddr();
});
mac.addEventListener('input', () => {
  dirty = true;
  updateEui();
});
euiPrefix.addEventListener('input', () => {
  dirty = true;
  updateEui();
});
splitIn.addEventListener('input', () => {
  dirty = true;
  updateSplit();
});
splitTo.addEventListener('input', () => {
  dirty = true;
  updateSplit();
});

document.addEventListener('click', (e) => {
  const t = e.target;
  const ex = t.closest('[data-v6]');
  if (ex) {
    v6.value = ex.dataset.v6;
    dirty = true;
    updateAddr();
    v6.focus();
  } else if (t.closest('[data-ula]')) {
    newUla();
  } else if (t.closest('[data-share]')) {
    flushUrl();
    copyText(location.href, 'Link copied');
    track('share', { tool: 'ipv6' });
  } else if (t.closest('[data-copy-summary]')) {
    const text = currentSummary();
    if (!text) return;
    copyText(text, 'Summary copied');
    track('copy', { tool: 'ipv6', kind: 'summary' });
  } else if (t.closest('[data-copy-ula]') && ula) {
    copyText(ula.prefix, 'ULA prefix copied');
    track('copy', { tool: 'ipv6', kind: 'ula' });
  } else if (t.closest('[data-download-split]')) {
    const all = document.querySelector('#split-out [data-copy]')?.dataset.copy;
    if (!all) return;
    download('ipv6-split.txt', `IPv6 split of ${splitIn.value.trim()} to /${splitTo.value}\n\n${all}\n`);
    track('download', { tool: 'ipv6', format: 'txt' });
  }
});

// ── start: restore every tool's state from the URL, defensively.
const q = param('q');
const m = param('mac');
const e = param('eui');
const s = param('s');
const n = param('n');
const u = param('u');
if (q !== null) v6.value = q;
if (m !== null) mac.value = m;
if (e !== null) euiPrefix.value = e;
if (s !== null) splitIn.value = s;
if (n !== null && n !== '') splitTo.value = n;

if (v6.value !== DEFAULTS.addr) updateAddr();
if (mac.value !== DEFAULTS.mac || euiPrefix.value !== DEFAULTS.eui) updateEui();
if (splitIn.value !== DEFAULTS.split || Number(splitTo.value) !== DEFAULTS.newPrefix) updateSplit();
setUla(validUla(u) ?? generateUla());
flushUrl();
