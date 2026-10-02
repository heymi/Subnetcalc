// Saved-plan list operations for the VLSM planner. Pure functions; the page owns storage.
// A plan is { id, name, query, savedAt } where `query` is the share query (?p=...&r=...).

export const MAX_PLANS = 50;
export const MAX_NAME = 60;
const MAX_QUERY = 4000;

export function sanitizePlanName(name, fallback = 'Untitled plan') {
  const s = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return s || fallback;
}

/**
 * Parse an exported plan list defensively. Returns null when the text is not a plan list;
 * unusable entries are dropped rather than failing the whole import.
 */
export function parsePlanList(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch {
    return null;
  }
  const list = Array.isArray(data) ? data : data?.plans;
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const item of list.slice(0, MAX_PLANS)) {
    if (!item || typeof item !== 'object') continue;
    const query = typeof item.query === 'string' ? item.query.slice(0, MAX_QUERY) : '';
    if (!query.startsWith('?')) continue;
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id.slice(0, 40) : `p${out.length + 1}`,
      name: sanitizePlanName(item.name),
      query,
      savedAt: typeof item.savedAt === 'string' ? item.savedAt.slice(0, 30) : '',
    });
  }
  return out;
}

/** Newest first, one entry per id, capped at MAX_PLANS. */
export function upsertPlan(list, plan) {
  const next = list.filter((p) => p.id !== plan.id);
  next.unshift(plan);
  return next.slice(0, MAX_PLANS);
}

export const removePlan = (list, id) => list.filter((p) => p.id !== id);

export function serializePlans(list) {
  return JSON.stringify({ version: 1, plans: list }, null, 2) + '\n';
}
