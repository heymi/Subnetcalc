// Subnet calculator page.
import { analyze } from '../../lib/subnet.js';
import { toText, toJSON, toCSV, toExplain } from '../../lib/export.js';
import { renderResults, renderNotices, renderBinary, renderSteps, describeBit } from './calc-render.js';
import { esc, setParams, param, copyText, copyShare, download, setStale } from './ui.js';
import { track } from './analytics.js';

const $ = (s) => document.querySelector(s);
const form = $('[data-calc]');
const input = $('#q');
const status = $('#status');
const results = $('#results');
const meta = $('#result-meta');
const bits = $('#bits');
const steps = $('#steps');
const detail = $('#bit-detail');
const resultSections = [$('#result'), $('#worked'), $('#binary')];

const BASE_TITLE = document.title;
const DETAIL_HINT = detail.textContent;
let maskAs = param('maskAs') === 'wildcard' ? 'wildcard' : undefined;
let info = null;
let selected = null;
let dirty = false;
let lastState = null;
let trackTimer;

function syncUrl(q) {
  setParams({ q: q.trim(), maskAs });
  document.title = q.trim() ? `${q.trim()} – Subnet Calculator` : BASE_TITLE;
}

function trackState(ok, code) {
  if (!dirty) return;
  const state = ok ? 'ok' : code || 'error';
  if (state === lastState) return;
  lastState = state;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (ok) track('calc_done', { tool: 'subnet' });
    else if (code && code !== 'INCOMPLETE' && code !== 'EMPTY') track('input_error', { tool: 'subnet', code });
  }, 700);
}

function render() {
  const q = input.value;
  const r = analyze(q, maskAs ? { maskAs } : undefined);
  syncUrl(q);
  if (!r.ok) {
    info = null;
    setStale(resultSections, true);
    if (r.error.code === 'INCOMPLETE' || r.error.code === 'EMPTY') {
      status.innerHTML = '';
    } else {
      status.innerHTML = `<p class="notice is-error"><strong>${esc(label(r.error.code))}</strong> ${esc(r.error.message)}.</p>`;
    }
    trackState(false, r.error.code);
    return;
  }
  info = r.info;
  setStale(resultSections, false);
  trackState(true);
  status.innerHTML = renderNotices(info);
  results.innerHTML = renderResults(info);
  meta.textContent = info.cidr;
  bits.innerHTML = renderBinary(info);
  steps.innerHTML = renderSteps(info);
  const max = info.version === 4 ? 32 : 128;
  if (selected !== null && selected < max) select(selected);
  else {
    selected = null;
    detail.textContent = DETAIL_HINT;
  }
}

function label(code) {
  return (
    {
      INVALID_ADDRESS: 'Not a valid address:',
      INVALID_PREFIX: 'Invalid prefix:',
      INVALID_MASK: 'Invalid mask:',
      NON_CONTIGUOUS_MASK: 'Mask has gaps:',
    }[code] || 'Cannot read this:'
  );
}

function select(i) {
  selected = i;
  for (const el of bits.querySelectorAll('.sel')) el.classList.remove('sel');
  for (const el of bits.querySelectorAll(`[data-i="${i}"]`)) el.classList.add('sel');
  detail.innerHTML = describeBit(info, i);
}

input.addEventListener('input', () => {
  maskAs = undefined;
  dirty = true;
  render();
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  render();
});

document.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-example]');
  if (ex) {
    input.value = ex.dataset.example;
    maskAs = undefined;
    dirty = true;
    track('example', { tool: 'subnet' });
    render();
    input.focus();
    return;
  }
  const act = e.target.closest('[data-action]');
  if (act) {
    const a = act.dataset.action;
    if (a === 'set') {
      input.value = act.dataset.value;
      maskAs = undefined;
    } else if (a === 'as-wildcard') maskAs = 'wildcard';
    else if (a === 'as-mask') maskAs = undefined;
    dirty = true;
    render();
    return;
  }
  const bit = e.target.closest('.bit[data-i]');
  if (bit && info) {
    select(Number(bit.dataset.i));
    return;
  }
  const exp = e.target.closest('[data-export]');
  if (exp && info) {
    const fmt = exp.dataset.export;
    const text = fmt === 'summary' ? toExplain(info) : fmt === 'json' ? toJSON(info) : fmt === 'csv' ? toCSV(info) : toText(info);
    copyText(text, fmt === 'summary' ? 'Summary copied' : `Copied as ${fmt.toUpperCase()}`);
    track('copy', { tool: 'subnet', kind: fmt === 'summary' ? 'summary' : 'export', format: fmt });
    return;
  }
  if (e.target.closest('[data-download]') && info) {
    const fmt = e.target.closest('[data-download]').dataset.download;
    const text = fmt === 'json' ? toJSON(info) : fmt === 'csv' ? toCSV(info) : toText(info);
    download(`subnet-${info.cidr.replace(/[./]/g, '-')}.${fmt === 'json' ? 'json' : fmt === 'csv' ? 'csv' : 'txt'}`, text);
    track('download', { tool: 'subnet', format: fmt });
    return;
  }
  if (e.target.closest('[data-share]')) {
    copyShare({ q: input.value.trim(), maskAs }, 'Link copied');
    track('share', { tool: 'subnet' });
  }
});

// Start from ?q= when present; the default result is already pre-rendered in the HTML.
const q = param('q');
if (q !== null && q !== input.value) {
  input.value = q;
}
render();
if (document.activeElement === input) input.select();
