// IPv6 tools page.
import { generateUla } from '../../lib/subnet.js';
import { DEFAULTS, renderAddress, renderSplit, renderEui, renderUla } from './ipv6-render.js';
import { setParams, param, debounce } from './ui.js';

const $ = (s) => document.querySelector(s);
const v6 = $('#v6');
const mac = $('#mac');
const euiPrefix = $('#eui-prefix');
const splitIn = $('#split-in');
const splitTo = $('#split-to');

// Results that are null mean "still typing": keep the previous output, dimmed.
function show(el, html) {
  if (html === null) {
    el.classList.add('is-stale');
    return;
  }
  el.classList.remove('is-stale');
  el.innerHTML = html;
}

const syncUrl = debounce((q) => setParams({ q: q.trim() }), 300);
const updateAddr = () => {
  show($('#v6-out'), renderAddress(v6.value));
  syncUrl(v6.value);
};
const updateEui = () => show($('#eui-out'), renderEui(mac.value, euiPrefix.value));
const updateSplit = () => show($('#split-out'), renderSplit(splitIn.value, Number(splitTo.value)));
const newUla = () => ($('#ula-out').innerHTML = renderUla(generateUla()));

v6.addEventListener('input', updateAddr);
mac.addEventListener('input', updateEui);
euiPrefix.addEventListener('input', updateEui);
splitIn.addEventListener('input', updateSplit);
splitTo.addEventListener('input', updateSplit);
document.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-v6]');
  if (ex) {
    v6.value = ex.dataset.v6;
    updateAddr();
    v6.focus();
  } else if (e.target.closest('[data-ula]')) newUla();
});

const q = param('q');
if (q !== null && q !== v6.value) v6.value = q;
if (v6.value !== DEFAULTS.addr) updateAddr();
if (mac.value !== DEFAULTS.mac || euiPrefix.value !== DEFAULTS.eui) updateEui();
if (splitIn.value !== DEFAULTS.split || Number(splitTo.value) !== DEFAULTS.newPrefix) updateSplit();
newUla();
