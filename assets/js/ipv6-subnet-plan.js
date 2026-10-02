// IPv6 hierarchical subnet plan page.
import { renderPlan, PLAN_DEFAULTS } from './ipv6-plan-render.js';
import { param, setParams, debounce, copyText, download } from './ui.js';
import { track } from './analytics.js';

const $ = (s) => document.querySelector(s);
const parent = $('#plan-parent');
const site = $('#plan-site');
const lan = $('#plan-lan');
const out = $('#plan-out');

let summary = null;
let dirty = false;
let lastState = null;
let trackTimer;

const values = () => ({ p: parent.value.trim(), s: site.value.trim(), l: lan.value.trim() });
const flushUrl = () => {
  const { p, s, l } = values();
  setParams({
    p: p !== PLAN_DEFAULTS.parent ? p : '',
    s: s !== String(PLAN_DEFAULTS.site) ? s : '',
    l: l !== String(PLAN_DEFAULTS.lan) ? l : '',
  });
};
const syncUrl = debounce(flushUrl, 300);

function setActions() {
  for (const b of document.querySelectorAll('[data-plan-copy], [data-plan-download]')) b.disabled = !summary;
}

function trackState() {
  if (!dirty) return;
  const state = summary ? 'ok' : 'invalid';
  if (state === lastState) return;
  lastState = state;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (state === 'ok') track('calc_done', { tool: 'ipv6plan' });
    else track('input_error', { tool: 'ipv6plan', code: 'INVALID_PREFIX' });
  }, 700);
}

function update() {
  const { p, s, l } = values();
  const r = renderPlan(p, s === '' ? NaN : Number(s), l === '' ? NaN : Number(l));
  out.innerHTML = r.html;
  summary = r.summary;
  setActions();
  trackState();
}

for (const el of [parent, site, lan]) {
  el.addEventListener('input', () => {
    dirty = true;
    syncUrl();
    update();
  });
}

document.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-plan-example]');
  if (ex) {
    const [p, s, l] = ex.dataset.planExample.split('|');
    parent.value = p;
    site.value = s;
    lan.value = l;
    dirty = true;
    track('example', { tool: 'ipv6plan' });
    update();
    return;
  }
  if (e.target.closest('[data-share]')) {
    flushUrl();
    copyText(location.href, 'Link copied');
    track('share', { tool: 'ipv6plan' });
  } else if (e.target.closest('[data-plan-copy]') && summary) {
    copyText(summary, 'Summary copied');
    track('copy', { tool: 'ipv6plan', kind: 'summary' });
  } else if (e.target.closest('[data-plan-download]') && summary) {
    download('ipv6-subnet-plan.txt', summary);
    track('download', { tool: 'ipv6plan', format: 'txt' });
  }
});

const p = param('p');
const s = param('s');
const l = param('l');
if (p !== null) parent.value = p;
if (s !== null && s !== '') site.value = s;
if (l !== null && l !== '') lan.value = l;
if (parent.value !== PLAN_DEFAULTS.parent || site.value !== String(PLAN_DEFAULTS.site) || lan.value !== String(PLAN_DEFAULTS.lan)) update();
else {
  summary = renderPlan(PLAN_DEFAULTS.parent, PLAN_DEFAULTS.site, PLAN_DEFAULTS.lan).summary;
  setActions();
}
