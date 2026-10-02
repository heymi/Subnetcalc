// CIDR tools page: aggregation, supernet, overlaps, range to CIDR.
import { DEFAULT_NETS, renderNets, renderRange } from './cidr-render.js';
import { debounce } from './ui.js';

const $ = (s) => document.querySelector(s);
const nets = $('#nets');
const rStart = $('#r-start');
const rEnd = $('#r-end');

function updateNets() {
  const r = renderNets(nets.value);
  $('#nets-errors').innerHTML = r.errors;
  $('#agg-out').innerHTML = r.agg;
  $('#sup-out').innerHTML = r.sup;
  $('#ovl-out').innerHTML = r.ovl;
}

function updateRange() {
  const m = rStart.value.trim().match(/^(\S+)\s*[-–]\s*(\S+)$/);
  if (m) {
    rStart.value = m[1];
    rEnd.value = m[2];
  }
  $('#range-out').innerHTML = renderRange(rStart.value.trim(), rEnd.value.trim());
}

nets.addEventListener('input', debounce(updateNets, 80));
rStart.addEventListener('input', updateRange);
rEnd.addEventListener('input', updateRange);
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-nets-example]')) {
    nets.value = DEFAULT_NETS;
    updateNets();
  } else if (e.target.closest('[data-nets-clear]')) {
    nets.value = '';
    updateNets();
    nets.focus();
  }
});

// Defaults are pre-rendered; only re-render if the browser restored different form values.
if (nets.value !== DEFAULT_NETS) updateNets();
if (rStart.value !== '192.168.1.10' || rEnd.value !== '192.168.1.20') updateRange();
