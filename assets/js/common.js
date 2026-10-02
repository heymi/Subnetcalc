// Runs on every page: theme toggle, keyboard shortcuts, copy buttons, analytics.
import { copyText } from './ui.js';
import { track, toolName } from './analytics.js';

// ── Analytics: fill in the IDs to enable. Loaded only on the production host, after the page is idle.
const GA4_ID = ''; // e.g. 'G-XXXXXXXXXX'
const CLARITY_ID = ''; // e.g. 'abcdefghij'
const PROD_HOST = 'subnetcalc.dev';

// ── Theme: auto (system) → light → dark → auto
const root = document.documentElement;
const THEMES = ['auto', 'light', 'dark'];
const ICONS = {
  auto: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
  light:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>',
};
function currentTheme() {
  return root.dataset.theme || 'auto';
}
function applyTheme(t) {
  if (t === 'auto') delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === 'auto') localStorage.removeItem('theme');
    else localStorage.setItem('theme', t);
  } catch {}
  for (const b of document.querySelectorAll('[data-theme-toggle]')) {
    b.innerHTML = ICONS[t];
    b.setAttribute('aria-label', `Theme: ${t}. Switch theme`);
    b.title = `Theme: ${t}`;
  }
}
applyTheme(currentTheme());
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-toggle]');
  if (!b) return;
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  applyTheme(next);
});

// ── Keyboard: "/" focuses the main input, Esc clears it.
const primary = () => document.querySelector('[data-primary-input]');
document.addEventListener('keydown', (e) => {
  const el = e.target;
  const typing = el.closest?.('input, textarea, select, [contenteditable="true"]');
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const p = primary();
    if (p) {
      e.preventDefault();
      p.focus();
      p.select?.();
    }
  } else if (e.key === 'Escape' && el.matches?.('[data-primary-input]') && el.value) {
    e.preventDefault();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

// ── Copy buttons: <button data-copy="text"> or <button data-copy-from="#id">
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy], [data-copy-from]');
  if (!b || b.disabled) return;
  const src = b.dataset.copyFrom ? document.querySelector(b.dataset.copyFrom) : null;
  const text = src ? (src.value ?? src.textContent) : b.dataset.copy;
  copyText(text, b.dataset.copyLabel || 'Copied');
  track('copy', { tool: toolName(), kind: 'value' });
  b.classList.add('is-done');
  setTimeout(() => b.classList.remove('is-done'), 1200);
});

// ── Print buttons
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});

// ── Analytics
function loadScript(src) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.append(s);
}
function analytics() {
  if (location.hostname !== PROD_HOST) return;
  if (GA4_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID);
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`);
  }
  if (CLARITY_ID) {
    window.clarity =
      window.clarity ||
      function () {
        (window.clarity.q = window.clarity.q || []).push(arguments);
      };
    loadScript(`https://www.clarity.ms/tag/${CLARITY_ID}`);
  }
}
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
if (document.readyState === 'complete') idle(analytics);
else addEventListener('load', () => idle(analytics), { once: true });
