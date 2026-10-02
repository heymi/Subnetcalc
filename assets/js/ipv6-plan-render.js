// Pure renderer for the IPv6 hierarchical subnet plan page (also used to pre-render).
import { parseCidr, networkOf, formatCidr, SubnetError } from '../../lib/subnet.js';
import { esc, group, count } from './ui.js';

export const PLAN_DEFAULTS = { parent: '2001:db8:abcd::/48', site: 56, lan: 64 };
export const PLAN_SHOW = 16;

const notice = (msg) => `<p class="notice is-error"><strong>Check the input:</strong> ${esc(msg)}.</p>`;
const stepOf = (prefix) => 1n << BigInt(128 - prefix);

/**
 * Count the hierarchy between a parent prefix, a site prefix and a LAN prefix.
 * @returns {{ parent: object, sitePrefix: number, lanPrefix: number, sites: bigint, lansPerSite: bigint, totalLans: bigint }}
 */
export function planCounts(parentIn, sitePrefix, lanPrefix) {
  const parent = networkOf(parseCidr(parentIn));
  if (parent.version !== 6) throw new SubnetError('INVALID_ADDRESS', 'IPv6 subnet planning needs an IPv6 prefix', parentIn);
  const site = Number(sitePrefix);
  const lan = Number(lanPrefix);
  if (!Number.isInteger(site) || site < parent.prefix || site > 128) {
    throw new SubnetError('INVALID_PREFIX', `Site prefix must be between /${parent.prefix} and /128`, sitePrefix);
  }
  if (!Number.isInteger(lan) || lan < site || lan > 128) {
    throw new SubnetError('INVALID_PREFIX', `LAN prefix must be between /${site} and /128`, lanPrefix);
  }
  return {
    parent,
    sitePrefix: site,
    lanPrefix: lan,
    sites: 1n << BigInt(site - parent.prefix),
    lansPerSite: 1n << BigInt(lan - site),
    totalLans: 1n << BigInt(lan - parent.prefix),
  };
}

const nibbleNote = (p) => (p % 4 === 0 ? '' : ' (not a nibble boundary; reverse DNS zones need /4 steps)');

/**
 * @returns {{ html: string, summary: string|null, error: string|null }}
 */
export function renderPlan(parentIn, sitePrefix, lanPrefix) {
  let c;
  try {
    c = planCounts(parentIn, sitePrefix, lanPrefix);
  } catch (e) {
    if (!(e instanceof SubnetError)) throw e;
    if (e.code === 'INCOMPLETE' || e.code === 'EMPTY') return { html: '', summary: null, error: null };
    return { html: notice(e.message), summary: null, error: e.message };
  }
  const { parent, sites, lansPerSite, totalLans } = c;
  const sStep = stepOf(c.sitePrefix);
  const lStep = stepOf(c.lanPrefix);
  const siteAt = (i) => ({ version: 6, value: parent.value + i * sStep, prefix: c.sitePrefix });
  const shown = Number(sites < BigInt(PLAN_SHOW) ? sites : BigInt(PLAN_SHOW));
  const rows = [];
  for (let i = 0n; i < BigInt(shown); i++) {
    const site = siteAt(i);
    const first = { version: 6, value: site.value, prefix: c.lanPrefix };
    const last = { version: 6, value: site.value + (lansPerSite - 1n) * lStep, prefix: c.lanPrefix };
    rows.push(
      `<tr><td><a href="/?q=${esc(formatCidr(site))}">${esc(formatCidr(site))}</a></td><td class="num">${group(lansPerSite)}</td><td><a href="/?q=${esc(formatCidr(first))}">${esc(formatCidr(first))}</a></td><td><a href="/?q=${esc(formatCidr(last))}">${esc(formatCidr(last))}</a></td></tr>`,
    );
  }
  const lastSite = siteAt(sites - 1n);
  const html = `<div class="row"><span class="k">Hierarchy</span><span><b>${esc(formatCidr(parent))}</b> → /${c.sitePrefix} sites → /${c.lanPrefix} LANs</span></div>
<div class="row"><span class="k">Sites</span><span>${count(sites)} /${c.sitePrefix} block${sites === 1n ? '' : 's'} (2<sup>${c.sitePrefix - parent.prefix}</sup>)${nibbleNote(c.sitePrefix)}</span></div>
<div class="row"><span class="k">LANs per site</span><span>${count(lansPerSite)} /${c.lanPrefix} block${lansPerSite === 1n ? '' : 's'} (2<sup>${c.lanPrefix - c.sitePrefix}</sup>)${nibbleNote(c.lanPrefix)}</span></div>
<div class="row"><span class="k">Total /${c.lanPrefix} LANs</span><span><b>${count(totalLans)}</b> (2<sup>${c.lanPrefix - parent.prefix}</sup>)</span></div>
<div class="table-wrap" tabindex="0" style="margin-top: var(--s3)"><table class="data">
<thead><tr><th scope="col">Site</th><th scope="col" class="num">/${c.lanPrefix}s</th><th scope="col">First /${c.lanPrefix}</th><th scope="col">Last /${c.lanPrefix}</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></div>
<p class="hint" style="margin-top: var(--s2)">Showing the first ${shown} of ${group(sites)} site${sites === 1n ? '' : 's'}. Last site: <code>${esc(formatCidr(lastSite))}</code>.</p>`;

  const summary = [
    'IPv6 subnet plan',
    `Parent: ${formatCidr(parent)}`,
    `Site prefix: /${c.sitePrefix} -> ${count(sites)} sites`,
    `LAN prefix: /${c.lanPrefix} -> ${count(lansPerSite)} LANs per site`,
    `Total /${c.lanPrefix} LANs: ${count(totalLans)}`,
    `First site: ${formatCidr(siteAt(0n))}`,
    `Last site: ${formatCidr(lastSite)}`,
    'Rule: each level is a power-of-two split of the level above; /64 is the standard LAN size because SLAAC requires it.',
    'Computed with SubnetCalc (https://subnetcalc.dev).',
  ].join('\n') + '\n';
  return { html, summary, error: null };
}
