// Sanitized event tracking. No-ops until GA4/Clarity are enabled in common.js.
//
// Privacy rules: never pass raw addresses, MACs, names, host counts or full URLs.
// Only short, fixed-shape values from the allowlist below leave the page.

const KEYS = new Set(['tool', 'kind', 'family', 'code', 'format', 'count']);
const VALUE = /[^a-z0-9 _-]/gi;

// Captured when this module first evaluates, before page scripts can put an input
// into document.title (the calculator does). Never read the live title for analytics.
const PAGE_TITLE = typeof document === 'undefined' ? '' : document.title;

const cleanUrl = (value) => {
  try {
    const u = new URL(value);
    return u.origin + u.pathname;
  } catch {
    return '';
  }
};

/**
 * Sanitized page fields for analytics: the path only (no query string or fragment,
 * which carry the user's input), an input-free title, and a referrer stripped the same
 * way. GA4 defaults `page_referrer` to document.referrer, which on this site can hold
 * the previous page's input query. Every event gets these, not just page_view.
 */
export function pageContext(href, title = '', referrer = '') {
  return {
    page_location: cleanUrl(href),
    page_title: String(title ?? ''),
    page_referrer: referrer ? cleanUrl(referrer) : '',
  };
}

/**
 * pageContext for the current document: the title is captured at module load (before a
 * page script can add an input) and the referrer is read live, since it never changes.
 */
export const currentPageContext = () =>
  pageContext(
    typeof location === 'undefined' ? '' : location.href,
    PAGE_TITLE,
    typeof document === 'undefined' ? '' : document.referrer,
  );

function clean(key, value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value !== 'string') return undefined;
  return value.slice(0, 32).replace(VALUE, '');
}

/**
 * @param {string} name  event name, e.g. 'calc_done'
 * @param {Record<string, string|number>} [params]  allowlisted, sanitized metadata
 */
export function track(name, params = {}) {
  const cleanParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (!KEYS.has(k)) continue;
    const c = clean(k, v);
    if (c !== undefined && c !== '') cleanParams[k] = c;
  }
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, { ...currentPageContext(), ...cleanParams });
    if (typeof window.clarity === 'function') window.clarity('event', name);
  } catch {
    /* analytics must never break a calculation */
  }
}

/** Tool name from <body data-tool="...">, used by the shared copy handler. */
export const toolName = () => document.body?.dataset.tool || 'site';
