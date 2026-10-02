# Verification — 2026-10-03

## Completed

- Address scope/type now classify the entered address, including broad prefixes.
- Ambiguous wildcard selection survives sharing and reload (`maskAs=wildcard`).
- Invalid/incomplete input disables stale copying/export in Subnet, VLSM and IPv6.
- Terraform preserves allocations with repeated names and suffix collisions.
- `split()` requires a positive explicit limit; all callers provide one.
- Copy buttons cover class, IPv6 type, scope, and the IPv6 prefix; all tool inputs autofocus.
- IANA was downloaded directly; original CSV snapshots and SHA-256 hashes are retained,
  including RFC 9780's Dummy IPv6 Prefix. Retrieval dates are UTC.
- All 232 shared vectors record at least two validators, their versions, actual checks and references.
- Mobile grid sizing and long IPv6 strings no longer widen the page.

## Local checks

`npm run check`: 262 tests pass; site check: 9 pages, 0 errors, 0 warnings.
`npm run crosscheck`: every shared vector passes; Python 3.13.15, netaddr 1.3.0,
ipcalc 0.51 and ipv6calc 4.4.0. sipcalc was unavailable locally; CI also installs it.
See `test/vectors/README.md` for semantics and reproduction.

Lighthouse 13.5.0, local HTTP server, mobile and desktop presets. Scores are
Performance / Accessibility / Best practices / SEO:

| Page | Mobile | Desktop |
| --- | --- | --- |
| `/` | 98 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/vlsm/` | 97 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/cidr/` | 98 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/ipv6/` | 97 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/subnetting/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/cidr-cheat-sheet/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/ipv6-subnetting/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |

`404.html` is deliberately noindex and excluded from the SEO score gate.
These scores do not establish production-domain performance or analytics delivery.

Chrome checked seven primary pages at 390, 768 and 1440 CSS pixels: all document
widths equal their viewport widths. Tables retain their own horizontal scrolling.
Homepage screenshots: 390×844, 768×1024 and 1440×1000.

Full Lighthouse HTML/JSON reports, screenshots and browser observations are saved
outside the deploy root at `../Subnetcalc-artifacts/2026-10-03/` on this machine.

## Browser regression steps

| Action | Observed result |
| --- | --- |
| Enter `10.0.0.1 0.0.0.0`, select wildcard, reload | URL retains `maskAs=wildcard`; network is `10.0.0.1/32` |
| Enter `192.168.1.` after a valid result | Copy/export controls disabled; entering valid data enables them again |
| VLSM example, change parent to `192.168.1.0/30` | Named capacity error; Copy and Download disabled; `/24` restores them |
| IPv6: enter `2001:` then press Esc | Stale copy controls disabled; input clears |
| Enter `192.168.1.1/8` or `fd12:3456::1/0` | Private-Use / ULA classification follows the input address |
| Select the first bit in octet 4 of `192.168.1.37/26` | Bit 25, weight 128, network bit |
| Select Terraform export | `cidrsubnet()` values displayed; exports covered by Node tests |
| Cycle theme | System, light and dark modes visible |

The browser provider intercepted the Download action with its download UI; automated
download-event collection timed out. File serialization is verified by the export
tests; automated retrieval of that browser download remains unconfirmed.

## Deployed preview

https://review.subnetcalc-preview.pages.dev

Cloudflare deployment: `a7bea568.subnetcalc-preview.pages.dev` (review branch).
The browser loaded the homepage and seven other content/tool routes; the latter
returned HTTP 200 with `X-Robots-Tag: noindex`. `/test/`, `/scripts/` and `/.github/`
probes returned HTTP 404. Only static site files were uploaded, without Git,
tests, scripts, tokens or local reports. Shell HTTP requests were blocked by the
environment's proxy (403); browser network observations provide the online evidence.

## Remaining external gates

1. Provide this site's GA4 Measurement ID and Clarity Project ID; both remain empty.
2. Cloudflare Git project creation returned HTTP 401 / error 8000011: internal
   issue with the Git installation. Reconnect GitHub in Cloudflare, then create
   the production Pages project for `heymi/Subnetcalc`, branch `main`, build command
   `npm run check`, output `/`, Node 24. Keep this preview project separate.
3. Buy/connect `subnetcalc.dev`, verify HTTPS, add its GSC property and submit
   `https://subnetcalc.dev/sitemap.xml`. No accessible SubnetCalc GSC property or
   Cloudflare zone was present during this run.
4. The GitHub repository is still private. Public visibility and distribution
   remain user-owned actions. MIT and the README backlink are already present.

The parallel codes project was not modified. No domain purchase, production DNS
change, repository visibility change, social post or directory submission was made.
