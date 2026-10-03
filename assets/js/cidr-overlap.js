// Dedicated CIDR overlap checker page.
import { renderOverlapReport, DEFAULT_OVERLAP_NETS } from './cidr-render.js';
import { param, setParams, debounce, copyText, download } from './ui.js';
import { track } from './site-events.js';

const $ = (s) => document.querySelector(s);
const nets = $('#overlap-nets');
const out = $('#overlap-out');
const errors = $('#overlap-errors');

const EXAMPLES = {
  overlap: DEFAULT_OVERLAP_NETS,
  clean: '10.0.0.0/24\n10.0.1.0/24\n10.0.2.0/24',
  duplicate: '10.0.0.0/24\n10.0.0.0/24\n10.0.0.0/16',
};

let state = { blocked: false, summary: '' };
let dirty = false;
let lastState = null;
let trackTimer;

const flushUrl = () => setParams({ n: nets.value !== DEFAULT_OVERLAP_NETS ? nets.value : '' });
const syncUrl = debounce(flushUrl, 300);

function setActions() {
  for (const b of document.querySelectorAll('[data-overlap-copy], [data-overlap-download]')) b.disabled = state.blocked;
}

function trackState() {
  if (!dirty) return;
  const next = state.blocked ? 'invalid' : nets.value.trim() ? 'ok' : 'empty';
  if (next === lastState) return;
  lastState = next;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (next === 'ok') track('calc_done', { tool: 'overlap' });
    else if (next === 'invalid') track('input_error', { tool: 'overlap', code: 'INVALID_LINE' });
  }, 700);
}

function update() {
  const r = renderOverlapReport(nets.value);
  state = r;
  errors.innerHTML = r.errors;
  out.innerHTML = r.report;
  setActions();
  syncUrl();
  trackState();
}

nets.addEventListener('input', () => {
  dirty = true;
  syncUrl();
  update();
});

document.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-overlap-example]');
  if (ex) {
    nets.value = EXAMPLES[ex.dataset.overlapExample] ?? DEFAULT_OVERLAP_NETS;
    dirty = true;
    track('example', { tool: 'overlap', kind: ex.dataset.overlapExample });
    update();
    return;
  }
  if (e.target.closest('[data-overlap-clear]')) {
    nets.value = '';
    dirty = true;
    update();
    nets.focus();
  } else if (e.target.closest('[data-share]')) {
    flushUrl();
    copyText(location.href, 'Link copied');
    track('share', { tool: 'overlap' });
  } else if (e.target.closest('[data-overlap-copy]') && !state.blocked) {
    copyText(state.summary, 'Summary copied');
    track('copy', { tool: 'overlap', kind: 'summary' });
  } else if (e.target.closest('[data-overlap-download]') && !state.blocked) {
    download('cidr-overlap-report.txt', state.summary);
    track('download', { tool: 'overlap', format: 'txt' });
  }
});

const n = param('n');
if (n !== null) nets.value = n;
if (nets.value !== DEFAULT_OVERLAP_NETS) update();
else {
  state = renderOverlapReport(DEFAULT_OVERLAP_NETS);
  setActions();
}
