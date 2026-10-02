// VLSM planner page.
import { planVlsm, requiredPrefix, formatCidr } from '../../lib/subnet.js';
import { planToText } from '../../lib/export.js';
import {
  DEFAULT_PARENT,
  DEFAULT_REQUESTS,
  CAPACITY_PARENT,
  CAPACITY_REQUESTS,
  CLOUD_RULES,
  EXPORTS,
  parseRequestList,
  parseVlsmSearch,
  renderSummary,
  renderMap,
  renderTable,
  renderFree,
  renderTree,
  fittingPrefix,
} from './vlsm-render.js';
import { esc, debounce, copyText, download, setStale, toast } from './ui.js';
import { parsePlanList, removePlan, sanitizePlanName, serializePlans, upsertPlan } from './workspace.js';
import { track } from './analytics.js';

const $ = (s) => document.querySelector(s);
const form = $('[data-vlsm]');
const parentIn = $('#parent');
const s31 = $('#s31');
const s32 = $('#s32');
const cloudSel = $('#cloud');
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
let loadNotice = '';
let dirty = false;
let lastState = null;
let trackTimer;

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

// ── URL: ?p=192.168.1.0/24&r=Sales:120,Eng:50&s31=1 (built by hand to keep it readable)
const enc = (s) => encodeURIComponent(s).replace(/%2F/g, '/');
function queryString() {
  const r = readRows()
    .map((x) => `${enc(x.name)}:${Number.isFinite(x.hosts) ? x.hosts : ''}`)
    .join(',');
  return `?p=${enc(parentIn.value.trim())}&r=${r}${s31.checked ? '&s31=1' : ''}${s32.checked ? '&s32=1' : ''}${cloudSel.value !== 'generic' ? `&c=${cloudSel.value}` : ''}`;
}

function cloudRule() {
  return CLOUD_RULES[cloudSel.value] ?? CLOUD_RULES.generic;
}

// ── saved plans: localStorage only, no server and no account
const STORAGE_KEY = 'subnetcalc.vlsm.plans.v1';
let plans = loadPlans();

function loadPlans() {
  try {
    return parsePlanList(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}
function storePlans() {
  try {
    localStorage.setItem(STORAGE_KEY, serializePlans(plans));
  } catch {
    /* storage can be full or blocked; the list still works for this session */
  }
}
function renderSaved() {
  const list = $('#plan-list');
  if (!list) return;
  list.innerHTML = plans.length
    ? plans
        .map(
          (p) =>
            `<li><span class="plan-name">${esc(p.name)}</span><span class="plan-date">${esc(p.savedAt)}</span><span class="plan-actions"><button type="button" class="btn btn-ghost" data-load-plan="${esc(p.id)}">Load</button><button type="button" class="btn btn-ghost" data-del-plan="${esc(p.id)}">Delete</button></span></li>`,
        )
        .join('')
    : '<li class="plan-empty">No saved plans yet. Saving keeps the parent, subnets, capacity rule and options in this browser.</li>';
}
function applyQuery(query) {
  const u = parseVlsmSearch(query);
  if (!u) return false;
  parentIn.value = u.parent;
  s31.checked = u.s31;
  s32.checked = u.s32;
  cloudSel.value = u.cloud;
  applyCloudUI();
  setRows(
    u.entries.length
      ? u.entries.map((x) => ({ name: x.name, hosts: Number.isFinite(x.hosts) ? x.hosts : '' }))
      : [{ name: '', hosts: '' }],
  );
  loadNotice = '';
  collapsed = new Set();
  render();
  return true;
}
const newPlanId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function writeUrl() {
  const q = queryString();
  if (q !== location.search) history.replaceState(null, '', location.pathname + q);
}
const syncUrl = debounce(writeUrl, 300);

// ── render
function trackState(ok, code) {
  if (!dirty) return;
  const state = ok ? 'ok' : code || 'error';
  if (state === lastState) return;
  lastState = state;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (ok) track('calc_done', { tool: 'vlsm' });
    else if (code && code !== 'INCOMPLETE' && code !== 'EMPTY') track('input_error', { tool: 'vlsm', code });
  }, 700);
}

function setPlanActions() {
  const b = $('[data-copy-plan]');
  if (b) b.disabled = !plan;
}

function render() {
  const parent = parentIn.value;
  const list = readRows();
  syncUrl();
  const rule = cloudRule();
  const opts = {
    allowSlash31: s31.checked,
    allowSlash32: s32.checked,
    reservedHosts: rule.reservedHosts,
    minPrefix: rule.minPrefix,
    provider: rule.provider,
  };
  if (!parent.trim()) {
    status.innerHTML = loadNotice;
    plan = null;
    out.export.textContent = '';
    setStale(resultSections, true);
    setPlanActions();
    trackState(false, 'EMPTY');
    return;
  }
  const r = planVlsm(parent, list, opts);
  if (!r.ok) {
    plan = null;
    out.export.textContent = '';
    setStale(resultSections, true);
    status.innerHTML = loadNotice + errorHtml(r.error, list, opts);
    setPlanActions();
    trackState(false, r.error.code);
    return;
  }
  plan = r.plan;
  setStale(resultSections, false);
  status.innerHTML = loadNotice + (list.length ? '' : '<p class="notice">Add the subnets you need, with a host count for each.</p>');
  out.summary.innerHTML = renderSummary(plan);
  out.map.innerHTML = renderMap(plan);
  out.table.innerHTML = renderTable(plan);
  out.free.innerHTML = renderFree(plan);
  // keep folds that still exist in the new tree
  out.tree.innerHTML = renderTree(plan, collapsed);
  renderExport();
  setPlanActions();
  trackState(true);
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
  dirty = true;
  loadNotice = '';
  render();
});
form.addEventListener('submit', (e) => e.preventDefault());
function applyCloudUI() {
  const generic = cloudSel.value === 'generic';
  s31.disabled = !generic;
  s32.disabled = !generic;
  if (!generic) {
    s31.checked = false;
    s32.checked = false;
  }
  if (!generic) {
    const tab = document.querySelector(`#export-tabs [data-fmt="${cloudSel.value}"]`);
    if (tab) selectTab(tab);
  } else if (fmt === 'aws' || fmt === 'azure' || fmt === 'gcp') {
    const tab = document.querySelector('#export-tabs [data-fmt="csv"]');
    if (tab) selectTab(tab);
  }
}

form.addEventListener('change', (e) => {
  if (e.target === s31 || e.target === s32 || e.target === cloudSel) {
    dirty = true;
    loadNotice = '';
    if (e.target === cloudSel) applyCloudUI();
    render();
  }
});

reqs.addEventListener('paste', (e) => {
  if (!e.target.matches('input[type="text"]')) return;
  const text = e.clipboardData.getData('text');
  if (!/\n/.test(text.trim())) return;
  const { entries, errors } = parseRequestList(text);
  if (!entries.length) return;
  e.preventDefault();
  const before = readRows();
  const tr = e.target.closest('tr');
  const index = [...reqs.rows].indexOf(tr);
  const kept = before.slice(0, index);
  // Unreadable lines become rows with a blank host count instead of being dropped.
  setRows([...kept, ...entries.map((x) => (x.error ? { name: x.text, hosts: '' } : x))]);
  dirty = true;
  loadNotice = errors.length
    ? `<p class="notice is-error"><strong>Pasted line${errors.length === 1 ? '' : 's'} ${errors.map((x) => x.line).join(', ')} could not be read:</strong> ${errors
        .map((x) => `<code>${esc(x.text)}</code>`)
        .join(', ')}. ${errors.length === 1 ? 'It was' : 'They were'} added with a blank host count; fill it in or remove the row.</p>`
    : '';
  render();
});

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-remove]')) {
    t.closest('tr').remove();
    if (!reqs.rows.length) setRows([{ name: '', hosts: '' }]);
    dirty = true;
    loadNotice = '';
    render();
  } else if (t.closest('[data-add]')) {
    reqs.insertAdjacentHTML('beforeend', rowHtml());
    reqs.rows[reqs.rows.length - 1].querySelector('input').focus();
  } else if (t.closest('[data-example]')) {
    parentIn.value = DEFAULT_PARENT;
    s31.checked = false;
    setRows(DEFAULT_REQUESTS);
    collapsed = new Set();
    loadNotice = '';
    track('example', { tool: 'vlsm' });
    render();
  } else if (t.closest('[data-example-capacity]')) {
    parentIn.value = CAPACITY_PARENT;
    s31.checked = false;
    setRows(CAPACITY_REQUESTS);
    collapsed = new Set();
    loadNotice = '';
    track('example', { tool: 'vlsm', kind: 'capacity' });
    render();
  } else if (t.closest('[data-clear]')) {
    setRows([{ name: '', hosts: '' }]);
    collapsed = new Set();
    dirty = true;
    loadNotice = '';
    render();
    reqs.querySelector('input').focus();
  } else if (t.closest('[data-share-plan]')) {
    writeUrl();
    copyText(location.href, 'Plan link copied');
    track('share', { tool: 'vlsm' });
  } else if (t.closest('[data-save-plan]')) {
    const name = sanitizePlanName($('#save-name').value, parentIn.value.trim() || 'Untitled plan');
    plans = upsertPlan(plans, { id: newPlanId(), name, query: queryString(), savedAt: new Date().toISOString().slice(0, 10) });
    storePlans();
    renderSaved();
    $('#save-name').value = '';
    toast('Plan saved');
    track('save', { tool: 'vlsm', kind: 'plan' });
  } else if (t.closest('[data-load-plan]')) {
    const saved = plans.find((p) => p.id === t.closest('[data-load-plan]').dataset.loadPlan);
    if (saved && applyQuery(saved.query)) {
      toast('Plan loaded');
      track('load', { tool: 'vlsm', kind: 'plan' });
    }
  } else if (t.closest('[data-del-plan]')) {
    plans = removePlan(plans, t.closest('[data-del-plan]').dataset.delPlan);
    storePlans();
    renderSaved();
    toast('Plan deleted');
  } else if (t.closest('[data-export-plans]')) {
    download('subnetcalc-vlsm-plans.json', serializePlans(plans));
    track('download', { tool: 'vlsm', format: 'plans' });
  } else if (t.closest('[data-copy-plan]') && plan) {
    copyText(planToText(plan), 'Plan summary copied');
    track('copy', { tool: 'vlsm', kind: 'summary' });
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
    track('copy', { tool: 'vlsm', kind: 'export', format: fmt });
  } else if (t.closest('[data-export-download]') && plan) {
    const ex = EXPORTS.find((x) => x.id === fmt);
    const base = formatCidr(plan.parent).replace(/[./]/g, '-');
    download(`vlsm-${base}-${ex.id}.${ex.ext}`, out.export.textContent, ex.type);
    track('download', { tool: 'vlsm', format: fmt });
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

$('#plans-import')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const imported = parsePlanList(await file.text());
  if (!imported) {
    toast('That file is not a plan list');
    return;
  }
  let n = 0;
  for (const p of imported) {
    plans = upsertPlan(plans, { ...p, id: newPlanId() + n++ });
  }
  storePlans();
  renderSaved();
  toast(`Imported ${n} plan${n === 1 ? '' : 's'}`);
  track('save', { tool: 'vlsm', kind: 'import', count: n });
});

// ── start
renderSaved();
const fromUrl = parseVlsmSearch(location.search);
if (fromUrl) {
  parentIn.value = fromUrl.parent;
  s31.checked = fromUrl.s31;
  s32.checked = fromUrl.s32;
  cloudSel.value = fromUrl.cloud;
  applyCloudUI();
  setRows(
    fromUrl.entries.length
      ? fromUrl.entries.map((x) => ({ name: x.name, hosts: Number.isFinite(x.hosts) ? x.hosts : '' }))
      : [{ name: '', hosts: '' }],
  );
  if (fromUrl.bad.length) {
    loadNotice =
      '<p class="notice is-error"><strong>This link could not be read completely.</strong> The affected rows keep the raw text; enter the values again.</p>';
  } else if (fromUrl.incomplete) {
    loadNotice = '<p class="notice is-error"><strong>This link left a host count blank.</strong> Fill it in or remove the row.</p>';
  }
}
render();
