// First-party event facade used by every page module.
//
// The implementation in analytics.js is optional and loaded dynamically: if a browser
// extension, network filter or offline cache blocks that file, events are dropped but
// every tool keeps working. Events fired before the implementation resolves are queued.

let impl = null;
let enabled = false;
const queue = [];

import('./analytics.js')
  .then((m) => {
    impl = m;
    m.setAnalyticsEnabled(enabled);
    for (const [name, params] of queue.splice(0)) m.track(name, params);
  })
  .catch(() => {
    queue.length = 0;
  });

export function setAnalyticsEnabled(on) {
  enabled = Boolean(on);
  if (impl) impl.setAnalyticsEnabled(enabled);
}

/**
 * @param {string} name
 * @param {Record<string, string|number>} [params]
 */
export function track(name, params = {}) {
  if (!enabled) return;
  if (impl) return impl.track(name, params);
  if (queue.length < 20) queue.push([name, params]);
}

/** Tool name from <body data-tool="...">, used by the shared copy handler. */
export const toolName = () => document.body?.dataset.tool || 'site';
