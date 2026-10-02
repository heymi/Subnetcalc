// VLSM planner page.
import { planVlsm, requiredPrefix, formatCidr } from '../../lib/subnet.js';
import {
  DEFAULT_PARENT,
  DEFAULT_REQUESTS,
  EXPORTS,
  renderSummary,
  renderMap,
  renderTable,
  renderFree,
  renderTree,
  fittingPrefix,
} from './vlsm-render.js';
import { esc, debounce, copyText, download, setStale } from './ui.js';

const $ = (s) => document.querySelector(s);
const form = $('[data-vlsm]');
const parentIn = $('#parent');
const s31 = $('#s31');
const reqs = $('#reqs');
const status = $('#vlsm-status');
const out = {
  summary: $('#vlsm-summary'),
  map: $('#vlsm-map'),
  table: $('#vlsm-table'),
  free: $('#vlsm-free'),
  tree: $('#vlsm-tree'),
  export: $('#export-out'),
};
const resultSections = [$('#plan'), $('#tree-section'), $('#export')];

let plan = null;
let fmt = 'csv';
let collapsed = new Set();

// ── rows
function rowHtml(name = '', hosts = '') {
  return `<tr><td><input class="input" type="text" aria-label="Subnet name" value="${esc(name)}"></td><td><input class="input hosts" type="number" min="1" step="1" inputmode="numeric" aria-label="Hosts needed" value="${esc(hosts)}"></td><td><button type="button" class="btn btn-ghost icon-btn" data-remove aria-label="Remove subnet">×</button></td></tr>`;
}
function setRows(list) {
  reqs.innerHTML = list.map((r) => rowHtml(r.name, r.hosts)).join('');
}
function readRows() {
  const list = [];
  for (const tr of reqs.rows) {
    const [nameEl, hostsEl] = tr.querySelectorAll('input');
    const name = nameEl.value.trim();
    const raw = hostsEl.value.trim();
    if (!name && !raw) continue;
    list.push({ name: name || `Subnet ${list.length + 1}`, hosts: raw === '' ? NaN : Number(raw) });
  }
  return list;
}

// "Sales 120", "Sales,120", "Sales\t120", "120 Sales"
function parseList(text) {
  const list = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let m = t.match(/^(.*?)[\s,;:=|]+(\d+)\s*(?:hosts?)?$/i);
    if (m && m[1]) list.push({ name: m[1].replace(/[,;:=|]+$/, '').trim(), hosts: Number(m[2]) });
    else if ((m = t.match(/^(\d+)[\s,;:=|]+(.+)$/))) list.push({ name: m[2].trim(), hosts: Number(m[1]) });
  }
  return list;
}

// ── URL: ?p=192.168.1.0/24&r=Sales:120,Eng:50&s31=1 (built by hand to keep it readable)
const enc = (s) => encodeURIComponent(s).replace(/%2F/g, '/');
function writeUrl(parent, list) {
  const r = list.map((x) => `${enc(x.name)}:${Number.isFinite(x.hosts) ? x.hosts : ''}`).join(',');
  let q = `?p=${enc(parent.trim())}&r=${r}`;
  if (s31.checked) q += '&s31=1';
  if (q !== location.search) history.replaceState(null, '', location.pathname + q);
}
function readUrl() {
  const sp = new URLSearchParams(location.search.replace(/\+/g, '%2B'));
  const p = sp.get('p');
  const r = new URLSearchParams(location.search).has('r') ? location.search.match(/[?&]r=([^&]*)/)[1] : null;
  if (p === null && r === null) return null;
  const list = (r || '')
    .split(',')
    .filter(Boolean)
    .map((item) => {
      const i = item.lastIndexOf(':');
      const name = decodeURIComponent(i === -1 ? item : item.slice(0, i));
      const hosts = i === -1 ? NaN : Number(item.slice(i + 1));
      return { name, hosts };
    });
  return { parent: p ?? DEFAULT_PARENT, list, s31: sp.get('s31') === '1' };
}
const syncUrl = debounce(writeUrl, 300);

// ── render
function render() {
  const parent = parentIn.value;
  const list = readRows();
  syncUrl(parent, list);
  const opts = { allowSlash31: s31.checked };
  if (!parent.trim()) {
    status.innerHTML = '';
    plan = null;
    out.export.textContent = '';
    setStale(resultSections, true);
    return;
  }
  const r = planVlsm(parent, list, opts);
  if (!r.ok) {
    plan = null;
    out.export.textContent = '';
    setStale(resultSections, true);
    status.innerHTML = errorHtml(r.error, list, opts);
    return;
  }
  plan = r.plan;
  setStale(resultSections, false);
  status.innerHTML = list.length ? '' : '<p class="notice">Add the subnets you need, with a host count for each.</p>';
  out.summary.innerHTML = renderSummary(plan);
  out.map.innerHTML = renderMap(plan);
  out.table.innerHTML = renderTable(plan);
  out.free.innerHTML = renderFree(plan);
  // keep folds that still exist in the new tree
  out.tree.innerHTML = renderTree(plan, collapsed);
  renderExport();
}

function errorHtml(e, list, opts) {
  if (e.code === 'INCOMPLETE') return '';
  let s = `<p class="notice is-error"><strong>${e.code === 'INSUFFICIENT_SPACE' ? 'Does not fit:' : 'Check the input:'}</strong> ${esc(e.message)}.`;
  if (e.code === 'INSUFFICIENT_SPACE') {
    let p = null;
    try {
      p = fittingPrefix(list, (x) => requiredPrefix(x.hosts, opts));
    } catch {}
    const base = parentIn.value.trim().split(/[\s/]/)[0];
    if (p !== null) {
      s += ` Everything fits in a <strong>/${p}</strong>. <button type="button" data-set-prefix="${p}">Use ${esc(base)}/${p}</button>`;
    }
  }
  return s + '</p>';
}

function renderExport() {
  if (!plan) return;
  const e = EXPORTS.find((x) => x.id === fmt);
  out.export.textContent = e.fn(plan);
}

function allSplits(node, depth = 0, acc = []) {
  if (node.state === 'split') {
    if (depth > 0) acc.push(formatCidr(node.cidr));
    node.children.forEach((c) => allSplits(c, depth + 1, acc));
  }
  return acc;
}

// ── events
form.addEventListener('input', (e) => {
  if (e.target.matches('#reqs input')) {
    // keep only one trailing empty row's worth of noise out of the URL; nothing else to do
  }
  render();
});
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('change', (e) => {
  if (e.target === s31) render();
});

reqs.addEventListener('paste', (e) => {
  if (!e.target.matches('input[type="text"]')) return;
  const text = e.clipboardData.getData('text');
  if (!/\n/.test(text.trim())) return;
  const list = parseList(text);
  if (!list.length) return;
  e.preventDefault();
  const before = readRows();
  const tr = e.target.closest('tr');
  const index = [...reqs.rows].indexOf(tr);
  const kept = before.slice(0, index);
  setRows([...kept, ...list]);
  render();
});

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-remove]')) {
    t.closest('tr').remove();
    if (!reqs.rows.length) setRows([{ name: '', hosts: '' }]);
    render();
  } else if (t.closest('[data-add]')) {
    reqs.insertAdjacentHTML('beforeend', rowHtml());
    reqs.rows[reqs.rows.length - 1].querySelector('input').focus();
  } else if (t.closest('[data-example]')) {
    parentIn.value = DEFAULT_PARENT;
    s31.checked = false;
    setRows(DEFAULT_REQUESTS);
    collapsed = new Set();
    render();
  } else if (t.closest('[data-clear]')) {
    setRows([{ name: '', hosts: '' }]);
    collapsed = new Set();
    render();
    reqs.querySelector('input').focus();
  } else if (t.closest('[data-set-prefix]')) {
    const p = t.closest('[data-set-prefix]').dataset.setPrefix;
    parentIn.value = `${parentIn.value.trim().split(/[\s/]/)[0]}/${p}`;
    render();
  } else if (t.closest('[data-tree]')) {
    collapsed = t.closest('[data-tree]').dataset.tree === 'expand' ? new Set() : new Set(plan ? allSplits(plan.tree) : []);
    if (plan) out.tree.innerHTML = renderTree(plan, collapsed);
  } else if (t.closest('#vlsm-tree [data-node]')) {
    toggleNode(t.closest('[data-node]').dataset.node);
  } else if (t.closest('#export-tabs [data-fmt]')) {
    selectTab(t.closest('[data-fmt]'));
  } else if (t.closest('[data-export-copy]') && plan) {
    copyText(out.export.textContent, `Copied ${EXPORTS.find((x) => x.id === fmt).label}`);
  } else if (t.closest('[data-export-download]') && plan) {
    const ex = EXPORTS.find((x) => x.id === fmt);
    const base = formatCidr(plan.parent).replace(/[./]/g, '-');
    download(`vlsm-${base}-${ex.id}.${ex.ext}`, out.export.textContent, ex.type);
  }
});

function toggleNode(key) {
  if (!plan) return;
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  out.tree.innerHTML = renderTree(plan, collapsed);
  out.tree.querySelector(`[data-node="${CSS.escape(key)}"]`)?.focus();
}

out.tree.addEventListener('keydown', (e) => {
  const n = e.target.closest?.('[data-node]');
  if (n && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    toggleNode(n.dataset.node);
  }
});

function selectTab(btn) {
  fmt = btn.dataset.fmt;
  for (const b of document.querySelectorAll('#export-tabs [data-fmt]')) b.setAttribute('aria-selected', String(b === btn));
  renderExport();
}
document.querySelector('#export-tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('#export-tabs [data-fmt]')];
  const i = tabs.indexOf(document.activeElement);
  if (i === -1) return;
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.focus();
  selectTab(next);
});

// ── start
const fromUrl = readUrl();
if (fromUrl) {
  parentIn.value = fromUrl.parent;
  s31.checked = fromUrl.s31;
  setRows(fromUrl.list.length ? fromUrl.list.map((x) => ({ name: x.name, hosts: Number.isFinite(x.hosts) ? x.hosts : '' })) : [{ name: '', hosts: '' }]);
}
render();
