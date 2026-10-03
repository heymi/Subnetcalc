// Runs on every page: theme toggle, keyboard shortcuts, copy buttons, analytics.
import { copyText } from './ui.js';
import { track, toolName, setAnalyticsEnabled } from './site-events.js';
import { currentPageContext } from './page-context.js';

// ── Analytics: loaded only after the visitor opts in.
const GA4_ID = 'G-DRX9HMD89W';
const CLARITY_ID = 'yrvsjr8v8f';
const PROD_HOSTS = new Set(['subnetcalc.dev', 'www.subnetcalc.dev']);
const ANALYTICS_CONSENT_KEY = 'subnetcalc.analytics-consent';

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
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy], [data-copy-from]');
  if (!b || b.disabled) return;
  const src = b.dataset.copyFrom ? document.querySelector(b.dataset.copyFrom) : null;
  const text = src ? (src.value ?? src.textContent) : b.dataset.copy;
  const ok = await copyText(text, b.dataset.copyLabel || 'Copied');
  track('copy', { tool: toolName(), kind: 'value' });
  if (!ok) return;
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

const CONSENT_DENIED = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
};
const CLARITY_CONSENT_DENIED = { ad_Storage: 'denied', analytics_Storage: 'denied' };

function canLoadClarity() {
  if (!['/privacy/', '/learn/'].includes(location.pathname) || location.search || location.hash) return false;

  if (document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.search || referrer.hash) return false;
    } catch {
      return false;
    }
  }

  // Clarity captures clicked URLs separately from the page URL. Avoid loading it on
  // pages whose links can carry query values, including calculator share examples.
  return [...document.querySelectorAll('a[href]')].every((link) => {
    try {
      const url = new URL(link.href, location.href);
      return !url.search;
    } catch {
      return false;
    }
  });
}

function startAnalytics() {
  if (analyticsConsent !== 'granted' || !PROD_HOSTS.has(location.hostname) || analyticsStarted) return;
  analyticsStarted = true;
  setAnalyticsEnabled(true);

  if (GA4_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', CONSENT_DENIED);
    window.gtag('consent', 'update', { ...CONSENT_DENIED, analytics_storage: 'granted' });
    window.gtag('js', new Date());
    // The automatic page_view is off, and this one is sent with a path-only location,
    // input-free title, and cleaned referrer. Enhanced Measurement is off in the
    // property, so it cannot add its own page, history, link, or form events.
    const context = currentPageContext();
    window.gtag('config', GA4_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ...context,
    });
    window.gtag('event', 'page_view', context);
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`);
  }
  if (CLARITY_ID && canLoadClarity()) {
    window.clarity =
      window.clarity ||
      function () {
        (window.clarity.q = window.clarity.q || []).push(arguments);
      };
    window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    loadScript(`https://www.clarity.ms/tag/${CLARITY_ID}`);
  }
}

function readAnalyticsConsent() {
  try {
    const value = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

let analyticsConsent = null;
let analyticsStarted = false;

function initAnalyticsPreferences() {
  if (!PROD_HOSTS.has(location.hostname)) return;

  analyticsConsent = readAnalyticsConsent();
  setAnalyticsEnabled(analyticsConsent === 'granted');

  const controls = document.createElement('div');
  controls.className = 'analytics-privacy-controls';
  controls.id = 'analytics-privacy-controls';
  controls.innerHTML = `
    <aside id="analytics-prefs-panel" class="analytics-prefs-panel" aria-labelledby="analytics-prefs-title" aria-describedby="analytics-prefs-copy">
      <h2 id="analytics-prefs-title">Optional analytics</h2>
      <p id="analytics-prefs-copy"><span data-analytics-current></span> Google Analytics and Microsoft Clarity help us understand site usage. They stay off until you allow analytics. <a href="/privacy/#analytics">Privacy details</a></p>
      <div class="analytics-prefs-actions">
        <button type="button" class="btn" data-analytics-consent="granted">Allow analytics</button>
        <button type="button" class="btn" data-analytics-consent="denied">Reject</button>
        <button type="button" class="btn btn-ghost" data-analytics-consent="later">Later</button>
      </div>
    </aside>
    <button type="button" class="btn analytics-settings-toggle" aria-expanded="false" aria-controls="analytics-prefs-panel">Analytics settings</button>
  `;
  document.body.append(controls);

  const panel = controls.querySelector('.analytics-prefs-panel');
  const settingsButton = controls.querySelector('.analytics-settings-toggle');
  const currentChoice = controls.querySelector('[data-analytics-current]');
  let panelOpen = analyticsConsent === null;

  const render = () => {
    panel.hidden = !panelOpen;
    currentChoice.textContent = analyticsConsent === 'granted'
      ? 'Current choice: allowed.'
      : analyticsConsent === 'denied'
        ? 'Current choice: rejected.'
        : 'No choice saved; analytics remain off.';
    settingsButton.setAttribute('aria-expanded', String(panelOpen));
  };

  settingsButton.addEventListener('click', () => {
    panelOpen = !panelOpen;
    render();
  });

  controls.addEventListener('click', (event) => {
    const button = event.target.closest('[data-analytics-consent]');
    if (!button) return;

    const choice = button.dataset.analyticsConsent;
    if (choice === 'later') {
      panelOpen = false;
      render();
      settingsButton.focus({ preventScroll: true });
      return;
    }

    const previousChoice = analyticsConsent;
    let saved = false;
    try {
      localStorage.setItem(ANALYTICS_CONSENT_KEY, choice);
      saved = true;
    } catch {
      // The current-page choice still applies if storage is unavailable.
    }
    analyticsConsent = choice;
    panelOpen = false;
    render();
    settingsButton.focus({ preventScroll: true });

    if (choice === 'granted') {
      startAnalytics();
      return;
    }

    setAnalyticsEnabled(false);
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', CONSENT_DENIED);
    if (typeof window.clarity === 'function') window.clarity('consentv2', CLARITY_CONSENT_DENIED);
    // Clarity runs only on static, query-free pages. Reload after withdrawal so any
    // already loaded provider script stops collecting on this document as well.
    if (previousChoice === 'granted' && analyticsStarted && saved) location.reload();
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== ANALYTICS_CONSENT_KEY && event.key !== null) return;
    if (event.key === null) analyticsConsent = readAnalyticsConsent();
    else analyticsConsent = event.newValue === 'granted' || event.newValue === 'denied' ? event.newValue : null;
    setAnalyticsEnabled(analyticsConsent === 'granted');
    if (analyticsConsent === 'granted') startAnalytics();
    else if (analyticsStarted) {
      if (typeof window.gtag === 'function') window.gtag('consent', 'update', CONSENT_DENIED);
      if (typeof window.clarity === 'function') window.clarity('consentv2', CLARITY_CONSENT_DENIED);
      location.reload();
    }
    panelOpen = analyticsConsent === null;
    render();
  });

  render();
  if (analyticsConsent === 'granted') startAnalytics();
}

initAnalyticsPreferences();
