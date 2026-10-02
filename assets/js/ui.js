// Small helpers shared by the page scripts. No dependencies.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for HTML. */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** 1234567n -> "1,234,567" */
export function group(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const sup = (n) => String(n).replace(/\d/g, (d) => SUP[d]);

/** Exact count with separators, plus 2^n when the count is a power of two above 2^16. */
export function count(n) {
  const big = BigInt(n);
  const s = group(big);
  if (big > 65536n && (big & (big - 1n)) === 0n) return `${s} (2${sup(big.toString(2).length - 1)})`;
  return s;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

let toastEl;
let toastTimer;
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 1400);
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label);
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Replace URL query params without adding history entries. Empty values are removed. */
export function setParams(params) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === null || v === undefined) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = url.pathname + (url.search === '?' ? '' : url.search) + url.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
}

export const param = (k) => new URL(location.href).searchParams.get(k);

/** decodeURIComponent that returns the raw text instead of throwing on malformed % escapes. */
export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * A shareable URL for `baseHref` carrying exactly `params` (empty values removed).
 * Pure so the round-trip can be tested outside the browser.
 */
export function buildShareUrl(baseHref, params) {
  const url = new URL(baseHref, 'https://subnetcalc.dev');
  url.search = '';
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === null || v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  return url.href;
}

/** Copy the current page with exactly `params` in the query string. */
export function copyShare(params, label = 'Link copied') {
  copyText(buildShareUrl(location.href, params), label);
}

/** Keep the previous result visible, but prevent using it after invalid input. */
export function setStale(sections, stale) {
  for (const section of sections) {
    section.classList.toggle('is-stale', stale);
    section.inert = stale;
    for (const button of section.querySelectorAll('button')) button.disabled = stale;
  }
}
