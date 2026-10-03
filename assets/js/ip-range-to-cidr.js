// Dedicated IP range to CIDR page.
import { renderRange, rangeSummary, DEFAULT_RANGE } from './cidr-render.js';
import { param, setParams, debounce, copyText, download } from './ui.js';
import { track } from './site-events.js';

const $ = (s) => document.querySelector(s);
const start = $('#range-start');
const end = $('#range-end');
const out = $('#range-out');

let text = null;
let dirty = false;
let lastState = null;
let trackTimer;

const values = () => ({ a: start.value.trim(), b: end.value.trim() });
const flushUrl = () => {
  const { a, b } = values();
  setParams({ a: a !== DEFAULT_RANGE[0] ? a : '', b: b !== DEFAULT_RANGE[1] ? b : '' });
};
const syncUrl = debounce(flushUrl, 300);

function setActions() {
  for (const b of document.querySelectorAll('[data-range-copy], [data-range-download]')) b.disabled = !text;
}

function trackState() {
  if (!dirty) return;
  const state = text ? 'ok' : 'invalid';
  if (state === lastState) return;
  lastState = state;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (state === 'ok') track('calc_done', { tool: 'range' });
    else track('input_error', { tool: 'range', code: 'INVALID_RANGE' });
  }, 700);
}

function update() {
  // allow "first - last" pasted into the first field
  const m = start.value.trim().match(/^(\S+)\s*[-–]\s*(\S+)$/);
  if (m) {
    start.value = m[1];
    end.value = m[2];
  }
  const { a, b } = values();
  out.innerHTML = renderRange(a, b);
  text = rangeSummary(a, b);
  setActions();
  syncUrl();
  trackState();
}

for (const el of [start, end]) {
  el.addEventListener('input', () => {
    dirty = true;
    syncUrl();
    update();
  });
}

document.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-range-example]');
  if (ex) {
    const [a, b] = ex.dataset.rangeExample.split('|');
    start.value = a;
    end.value = b;
    dirty = true;
    track('example', { tool: 'range' });
    update();
    return;
  }
  if (e.target.closest('[data-share]')) {
    flushUrl();
    copyText(location.href, 'Link copied');
    track('share', { tool: 'range' });
  } else if (e.target.closest('[data-range-copy]') && text) {
    copyText(text, 'Summary copied');
    track('copy', { tool: 'range', kind: 'summary' });
  } else if (e.target.closest('[data-range-download]') && text) {
    download('ip-range-to-cidr.txt', text);
    track('download', { tool: 'range', format: 'txt' });
  }
});

const a = param('a');
const b = param('b');
if (a !== null) start.value = a;
if (b !== null) end.value = b;
if (start.value !== DEFAULT_RANGE[0] || end.value !== DEFAULT_RANGE[1]) update();
else {
  text = rangeSummary(...DEFAULT_RANGE);
  setActions();
}
