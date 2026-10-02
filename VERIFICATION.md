# Verification — 2026-10-03 (round 2)

## Completed

Round 2 (this pass):

- VLSM pastes keep every line. An unreadable line becomes a row with a blank host count and is
  named by line number in a notice, instead of being dropped silently.
- Malformed share params (`?r`, broken `%` escapes, blank host counts) no longer break
  initialization; they fall back to defaults with a readable notice.
- CIDR lists with invalid lines disable copy and download and report the overlap check as
  incomplete instead of showing "No overlaps".
- Every tool saves its full input in the URL. Copy, share and download sit next to results, and
  ticket summaries contain the input, the result and the rule behind it. ULA prefixes are fixed
  when shared, and IPv6 shares carry the MAC, EUI-64 prefix and split parameters.
- `/ip-range-to-cidr/` and `/cidr-overlap-checker/` dedicated pages with pre-rendered examples,
  edge cases, FAQ schema and internal links from `/cidr/`.
- Cloud capacity rules (AWS VPC: 5 reserved, minimum /28; Azure VNet: 5 reserved, minimum /29)
  are applied during allocation, in the results table and in the exports, so plan and export
  agree. The AWS/Azure exports no longer warn about a plan built under their own rule.
- `/ipv6-subnet-plan/` plans `/48 → /56 → /64` (and any other parent/site/LAN combination) with
  counts, first and last blocks per site and an off-nibble warning.
- `/verification/` is generated from the retained IANA snapshots and the shared vector counts;
  `/privacy/` covers local calculation, share links and analytics. The footer no longer claims
  that nothing ever leaves the browser.
- Analytics events are limited to tool, kind, error code, format and count; no addresses, MACs,
  names, host counts or full parameter URLs. Default example loads are tagged as examples and do
  not count as real use.

Round 1 (earlier commit `1d77672`): the three input fixes above, full share state, result
hierarchy with folded details, the two dedicated pages, verification and privacy pages, tests.

## Local checks

`npm run check`: 291 tests pass; site check: 14 pages, 0 errors, 0 warnings.

`npm run crosscheck` was not re-run in this pass: the engine vectors and their expected values are
unchanged, and all 232 still pass in the Node suite. The recorded cross-check used Python 3.13.15
(`ipaddress`), netaddr 1.3.0, Perl ipcalc 0.51 and ipv6calc 4.4.0; sipcalc is installed in CI.
See `test/vectors/README.md` for semantics and reproduction.

## Lighthouse

Lighthouse 13.5.0, local HTTP server, mobile and desktop presets. Scores are
Performance / Accessibility / Best practices / SEO.

| Page | Mobile | Desktop |
| --- | --- | --- |
| `/` | 96 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/vlsm/` | 96 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/cidr/` | 97 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/ipv6/` | 96 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/ip-range-to-cidr/` | 98 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/cidr-overlap-checker/` | 98 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/ipv6-subnet-plan/` | 98 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/verification/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/privacy/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/subnetting/` | 98 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/cidr-cheat-sheet/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/ipv6-subnetting/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |

`404.html` is deliberately noindex and excluded from the SEO score gate. These scores do not
establish production-domain performance or analytics delivery.

## Browser checks

- Chromium (Playwright, headless): 60 checks pass. 14 pages load without JS errors; VLSM paste
  keeps three rows and flags line 2; five malformed VLSM URLs initialize cleanly; CIDR invalid
  lines disable copy and clear the clean-list claim, and fixing the list re-enables it; share
  links for the subnet calculator, VLSM, CIDR, IPv6 (including a fixed ULA), range and overlap
  tools reopen with the same result; the AWS rule sizes a 60-host request at /25 and its export
  has no warning; the IPv6 plan counts and off-nibble note are correct; every page has no
  horizontal overflow at 390 CSS pixels.
- WebKit (Playwright): 20 checks pass. The same pages load without errors and the input fixes,
  cloud rule and share URLs behave identically.
- Firefox could not be launched in this environment: macOS denied the content-process sandbox
  (`sandbox_extension_issue_file_to_process ... Operation not permitted`). This is a local
  environment limit, not a site result; a manual Firefox pass remains open.

Full Lighthouse JSON reports and browser logs are saved outside the deploy root at
`../Subnetcalc-artifacts/2026-10-03-round2/` on this machine.

## Remaining external gates

1. Provide this site's GA4 Measurement ID and Clarity Project ID; both remain empty, so the
   analytics scripts are not loaded and the events are no-ops. Update `/privacy/` when IDs exist.
2. Cloudflare Git project creation returned HTTP 401 / error 8000011 in the previous pass:
   reconnect GitHub in Cloudflare, then create the production Pages project for `heymi/Subnetcalc`,
   branch `main`, build command `npm run check`, output `/`, Node 24.
3. Buy/connect `subnetcalc.dev`, verify HTTPS, add its GSC property and submit
   `https://subnetcalc.dev/sitemap.xml`.
4. The GitHub repository is still private. Public visibility and distribution remain user-owned.
5. A human visual pass at 390, 768 and 1440 CSS pixels over the new pages is still worthwhile;
   automated width checks and Lighthouse accessibility pass, but design judgment is not automated.

No domain purchase, production DNS change, repository visibility change, social post or directory
submission was made.
