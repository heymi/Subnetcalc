// Sanitized page fields shared by the event sender and the consent bootstrap.
//
// Path only (no query string or fragment, which carry the user's input), an input-free
// title and a referrer stripped the same way. GA4 defaults `page_referrer` to
// document.referrer, which on this site can hold the previous page's input query.
// The title is captured when this module first evaluates, before a page script can
// put an input into document.title (the calculator does).

const cleanUrl = (value) => {
  try {
    const u = new URL(value);
    return u.origin + u.pathname;
  } catch {
    return '';
  }
};

const PAGE_TITLE = typeof document === 'undefined' ? '' : document.title;

/**
 * @param {string} href
 * @param {string} [title]
 * @param {string} [referrer]
 */
export function pageContext(href, title = '', referrer = '') {
  return {
    page_location: cleanUrl(href),
    page_title: String(title ?? ''),
    page_referrer: referrer ? cleanUrl(referrer) : '',
  };
}

/** pageContext for the current document; the referrer is read live. */
export const currentPageContext = () =>
  pageContext(
    typeof location === 'undefined' ? '' : location.href,
    PAGE_TITLE,
    typeof document === 'undefined' ? '' : document.referrer,
  );
