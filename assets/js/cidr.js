// CIDR tools page: aggregation, supernet, overlaps, range to CIDR.
import { DEFAULT_NETS, DEFAULT_RANGE, renderNets, renderRange, rangeSummary } from './cidr-render.js';
import { debounce, copyText, download, param, setParams } from './ui.js';
import { track } from './analytics.js';

const $ = (s) => document.querySelector(s);
const nets = $('#nets');
const rStart = $('#r-start');
const rEnd = $('#r-end');
const actions = { share: $('[data-cidr-share]'), summary: $('[data-cidr-summary]'), download: $('[data-cidr-download]') };

let netsState = { blocked: false, summary: '' };
let rangeText = null;
let dirty = false;
let lastState = null;
let trackTimer;

function currentParams() {
  return {
    n: nets.value !== DEFAULT_NETS ? nets.value : '',
    a: rStart.value !== DEFAULT_RANGE[0] ? rStart.value.trim() : '',
    b: rEnd.value !== DEFAULT_RANGE[1] ? rEnd.value.trim() : '',
  };
}
const flushUrl = () => setParams(currentParams());
const syncUrl = debounce(flushUrl, 300);

function trackState() {
  if (!dirty) return;
  const state = netsState.blocked ? 'invalid' : nets.value.trim() ? 'ok' : 'empty';
  if (state === lastState) return;
  lastState = state;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (state === 'ok') track('calc_done', { tool: 'cidr' });
    else if (state === 'invalid') track('input_error', { tool: 'cidr', code: 'INVALID_LINE' });
  }, 700);
}

function updateActions() {
  const hasSummary = Boolean((nets.value.trim() && !netsState.blocked) || rangeText);
  const blocked = netsState.blocked;
  if (actions.summary) actions.summary.disabled = blocked || !hasSummary;
  if (actions.download) actions.download.disabled = blocked || !hasSummary;
}

function updateNets() {
  const r = renderNets(nets.value);
  netsState = r;
  $('#nets-errors').innerHTML = r.errors;
  $('#agg-out').innerHTML = r.agg;
  $('#sup-out').innerHTML = r.sup;
  $('#ovl-out').innerHTML = r.ovl;
  updateActions();
  trackState();
}

function updateRange() {
  const m = rStart.value.trim().match(/^(\S+)\s*[-–]\s*(\S+)$/);
  if (m) {
    rStart.value = m[1];
    rEnd.value = m[2];
  }
  const a = rStart.value.trim();
  const b = rEnd.value.trim();
  $('#range-out').innerHTML = renderRange(a, b);
  rangeText = rangeSummary(a, b);
  updateActions();
}

function summaryText() {
  const parts = [];
  if (nets.value.trim() && !netsState.blocked) parts.push(netsState.summary.trimEnd());
  if (rangeText) parts.push(rangeText.trimEnd());
  return parts.join('\n\n') + (parts.length ? '\n' : '');
}

const updateNetsSoon = debounce(updateNets, 80);
nets.addEventListener('input', () => {
  dirty = true;
  syncUrl();
  updateNetsSoon();
});
rStart.addEventListener('input', () => {
  dirty = true;
  syncUrl();
  updateRange();
});
rEnd.addEventListener('input', () => {
  dirty = true;
  syncUrl();
  updateRange();
});

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-nets-example]')) {
    nets.value = DEFAULT_NETS;
    updateNets();
    track('example', { tool: 'cidr' });
  } else if (t.closest('[data-nets-clear]')) {
    nets.value = '';
    updateNets();
    nets.focus();
  } else if (t.closest('[data-cidr-share]')) {
    flushUrl();
    copyText(location.href, 'Link copied');
    track('share', { tool: 'cidr' });
  } else if (t.closest('[data-cidr-summary]')) {
    copyText(summaryText(), 'Summary copied');
    track('copy', { tool: 'cidr', kind: 'summary' });
  } else if (t.closest('[data-cidr-download]')) {
    download('cidr-results.txt', summaryText());
    track('download', { tool: 'cidr', format: 'txt' });
  }
});

// Restore ?n= / ?a= / ?b= when present; the default results are pre-rendered in the HTML.
const n = param('n');
const a = param('a');
const b = param('b');
if (n !== null) nets.value = n;
if (a !== null) rStart.value = a;
if (b !== null) rEnd.value = b;
if (nets.value !== DEFAULT_NETS) updateNets();
if (rStart.value !== DEFAULT_RANGE[0] || rEnd.value !== DEFAULT_RANGE[1]) updateRange();
else rangeText = rangeSummary(rStart.value.trim(), rEnd.value.trim());
updateActions();
