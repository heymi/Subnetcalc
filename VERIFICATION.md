# Verification — 2026-10-05 (round 8)

## Completed

Round 8 (cheat sheet upgrade and `/subnetting-practice/`, commit `3db6c24`, merged in `658c849`):

- `/learn/cidr-cheat-sheet/` is retitled "Subnet cheat sheet: Subnet Mask & CIDR Table" across the
  title, description, Open Graph and JSON-LD headline, matching the terms the page and the site
  already use. Two lookup tables are pre-rendered from the engine: block size by last mask octet
  (/25–/30, subnet starts abbreviated past eight) and hosts needed to prefix (2 … 510).
- The downloadable PDF stays a single A4 page and now carries all three tables: the /0–/32 table,
  the magic numbers and the host-count lookup. The build throws if the content would run past the
  bottom margin. The PNG figure keeps the /0–/32 table and its alt text.
- New page `/subnetting-practice/`: one question at a time from five types (network and hosts,
  prefix to mask, mask to prefix, hosts to prefix, magic number) and three difficulties, checked in
  the browser with the answer and the steps after a miss. The seed, index, difficulty, types and
  timer live in the query string, so a link repeats the same set; the score lives in `localStorage`
  and counts the first attempt only, so re-checking after reading the answer does not raise it.
  `N` loads the next question outside an answer box, "Print 10 questions" builds a worksheet with a
  separate answer list, and ten fixed drills plus the worked magic-number example are pre-rendered
  for reading without JavaScript.
- A bug the browser pass caught on the first run: the difficulty/seed line sits outside the quiz
  form, so `root.querySelector('#practice-meta')` was null, `render()` threw and no answer fields
  were ever drawn. It now reads the element from the document.
- Shared type-filter links keep literal commas (`?t=mask-prefix,magic`) instead of `%2C`.
- The page is in the nav, the footer, `/learn/`, the subnet calculator hints, the VLSM host-count
  prose and the sitemap. 353 unit tests pass; site check: 18 pages, 0 errors, 0 warnings.
- 30 checks in Chromium and the same 30 in WebKit pass: the quiz flow (blank refusal, wrong answer
  with steps, the shown answer accepted on a re-check, first-try scoring against
  `makeQuestion()` from the engine), reload and back/forward state, the `N` key inside and outside
  inputs, difficulty and type filters, the timer, the share link, score persistence, the worksheet,
  the pre-rendered drills, the two new cheat sheet tables, the PDF and PNG, and no horizontal
  overflow at 390 CSS pixels on `/subnetting-practice/`, `/learn/cidr-cheat-sheet/`, `/learn/` and
  `/`. Reports: `../Subnetcalc-artifacts/2026-10-05-round8/`.

Round 7 (analytics decoupling, commit `822bb84`):

- Page modules no longer import the analytics implementation directly. A small facade
  (`assets/js/site-events.js`) loads it dynamically, queues events until it is ready and drops
  them if the file cannot load; the pure page-field helpers moved to
  `assets/js/page-context.js`. An extension or filter that blocks `analytics.js` now only
  disables analytics events: the consent panel, calculators and share/copy/download controls
  keep working. This was reproduced first: blocking `/assets/js/analytics.js` left the VLSM page
  with no consent panel and no button response before the fix.
- Browser checks grow to 115: a context that blocks `/assets/js/analytics.js` still renders the
  consent panel and shares a plan.

Round 6 (URL state fixes, commit `d9b0208`):

- Clear and example buttons now update the URL through the same render path as typing, so a
  refresh keeps the visible state in `/cidr/`, `/ip-range-to-cidr/`, `/cidr-overlap-checker/` and
  `/ipv6-subnet-plan/` instead of restoring the previous input. Clearing `/cidr/` drops the list
  parameter; a refresh then shows the page default, since the URL has no separate empty state.
- Browser checks grow to 113: clearing `/cidr/` and the range, overlap and IPv6 plan example
  buttons keep their state across a reload.

Round 5 (analytics consent, commit `ad53bc0`):

- GA4 and Clarity are opt-in. A consent panel (Allow, Reject, Later and a persistent "Analytics
  settings" button) appears on `subnetcalc.dev`, and the choice is kept in `localStorage`.
  `track()` no-ops until consent; GA4 uses Consent Mode with ad signals denied and its automatic
  page view off; Clarity is limited to query-free `/privacy/` and `/learn/` pages whose links
  carry no query string.
- Withdrawing consent sends the denied signals and reloads the page, so a provider script that
  already loaded stops collecting in that tab. The privacy page, README and unit tests cover the
  new behavior.

Round 4 (example pages, branch `site/examples`):

- Three fixed example pages with pre-rendered plans and deep links into the planners:
  `/examples/aws-three-tier-vpc/` (six /24s across two availability zones under AWS rules),
  `/examples/azure-hub-spoke/` (hub gateway/firewall/shared-services plus a spoke template) and
  `/examples/ipv6-48-56-64/` (one /48 into 256 /56 sites of 256 /64 LANs, first and last block
  per site).
- An Examples column in the footer on every page, a Worked examples section on `/learn/`, and
  links from the VLSM planner and the IPv6 subnet plan page.
- All three pass the site check (canonical, FAQ schema, internal links, sitemap) and Lighthouse:
  mobile 99 / 100 / 100 / 100, desktop 100 / 100 / 100 / 100.

Round 3 (earlier commit `380ee3e`):

- `/ipv6/` "Download list" is disabled when a split is too large to generate, with a title that
  explains why, instead of doing nothing.
- Google Cloud capacity rule: 4 reserved addresses (network, gateway, second-to-last, broadcast)
  and a /29 minimum, applied to allocation, the results table and the GCP export like AWS/Azure.
- New exports: CloudFormation (logical IDs, `CidrBlock`, Name tags), Bicep (subnet resources for an
  existing VNet), OSPF `network` statements, extended ACL entries and a summary `Null0` route.
- `/32` option for single-host requests (loopback / host route), alongside the `/31` option, saved
  in the share URL.
- IPv4 reverse DNS: PTR name for every address and the `in-addr.arpa` zone when the prefix is
  octet-aligned, shown in the calculator's details fold.
- 6to4 is marked "deprecated by RFC 7526" and Teredo "legacy transition mechanism"; the
  non-contiguous-mask error now explains that Cisco ACL wildcards of that shape do not map to CIDR.
- The VLSM planner can save plans in `localStorage`, reload them, delete them and export/import
  the list as JSON. Stored entries contain only the share query; the privacy note now lists this
  alongside the theme preference.

Round 3.1 (QA fixes, still on `site/round-3`):

- Cloud usable ranges now follow the provider reservation layout: AWS/Azure reserve the first
  four and the last address (usable `.4–.30` in a /27), GCP the first two and the last two
  (`.2–.29`). The fix covers the results table, CSV/JSON, ticket text and Cisco output.
- AWS rejects a request that would need a block larger than /16 (`PROVIDER_LIMIT`), and the
  planner shows it as a provider limit.
- The ACL export now emits a complete extended-ACL statement with a destination (`permit ip
  <net> <wildcard> any`), and the header says to replace `any`.
- Bicep strings escape reserved characters with a backslash (`\'`, `\${`), not doubled quotes.
- The IPv6 download button tracks whether the last render was fresh, so an incomplete input
  cannot download a stale list under the new input's filename.
- Copy actions report the real clipboard result; a failed copy shows a manual-copy message
  instead of "Copied".
- Analytics page views are sanitized before any ID is enabled: the automatic GA4 page view is
  off, the explicit one sends the path only and an input-free title, and the Clarity masking
  requirement is recorded as a gate.
- Every cloud export re-checks provider bounds, not just the provider built for: a generic /15
  or /30 is flagged in the AWS/GCP lists, CloudFormation (/16–/28) and Bicep (/29 minimum) with
  a per-subnet WARNING comment.
- Analytics page context is attached to every event, not only `page_view`: `track()` and the
  GA4 config both carry `page_location` without the query string, the title captured before
  page scripts can add an input, and `page_referrer` stripped of its query string and fragment
  (a same-site link from the calculator would otherwise carry `?q=...`), verified with a
  stubbed gtag in Chromium and WebKit.
- `reservedHosts: 0` works again: the default reservation layout is 0 + 0, so a no-reservation
  plan keeps every address (`requiredPrefix(20, { reservedHosts: 0 })` is /27).

Round 2 (earlier commit `59d9f9d`):

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

`npm run check`: 353 tests pass; site check: 18 pages, 0 errors, 0 warnings.

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
| `/learn/cidr-cheat-sheet/` | 96 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/subnetting-practice/` | 95 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/learn/ipv6-subnetting/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/examples/aws-three-tier-vpc/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/examples/azure-hub-spoke/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `/examples/ipv6-48-56-64/` | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |

`404.html` is deliberately noindex and excluded from the SEO score gate. These scores do not
establish production-domain performance or analytics delivery.

The two round-8 pages were measured in the same pass. `/subnetting-practice/` scores 95 mobile
(LCP 2.6 s, TBT 0 ms, CLS 0) and 100 desktop; `/learn/cidr-cheat-sheet/` scores 96 mobile against
99 in the earlier table, on LCP 2.7 s against 2.3 s. The unchanged `/learn/subnetting/` measured
98 in the same run, so the two-point difference is local throttling noise on a larger HTML payload,
not a regression: TBT is 0 ms and CLS is 0 on both pages. Reports are in
`../Subnetcalc-artifacts/2026-10-05-round8/lighthouse/`.

## Structured data

Google's Rich Results Test is a browser form with no public API, and an unauthenticated headless
browser is turned away: the tester posts to an internal Search Console RPC and rejects it, with the
page's own analytics event reporting `recaptcha-error` for `INSPECT-URL`. A signed-in run by the
owner on 2026-10-05 reported "2 valid items detected" and no errors for both round-8 pages:
`/learn/cidr-cheat-sheet/` with Articles 1 and Breadcrumbs 1, `/subnetting-practice/` with Software
apps 1 and Breadcrumbs 1, both crawled successfully.

Two things in that output are policy, not defects. The practice page's FAQ does not appear because
Google deprecated the FAQ rich result on 2026-05-07 and dropped it from the types the tool reports,
so the visible FAQ and its `FAQPage` markup stay for readers and AI surfaces only. Its remaining
`Software apps` warning needs an `aggregateRating` or a `review`, which this site will not invent, so
that item is valid but not badge-eligible.

As a repeatable substitute, every page's JSON-LD was parsed and checked against the properties
Google documents as required (`WebApplication`, `TechArticle`, `BreadcrumbList`, `FAQPage`,
`Question`, `Answer`, `ListItem`), breadcrumb positions and absolute items were verified against
each canonical, every FAQ answer and question was matched against the rendered page text, and
off-site URLs inside the schema were rejected. All 18 pages pass. Each of the three `TechArticle`
pages now declares an in-schema `image`, a `mainEntityOfPage` pointing at itself, and
`datePublished` 2026-10-02 (the date the page first shipped, from git) with `dateModified`
2026-10-05, the same value the sitemap carries.

## Browser checks

An acceptance pass against the round-8 checklist ran 16 checks in Chromium and the same 16 in
WebKit, all passing (`../Subnetcalc-artifacts/2026-10-05-round8/qa-acceptance-chromium.txt` and
`qa-acceptance-webkit.txt`): with JavaScript
disabled, the cheat sheet page keeps all three tables (89 rows), its figure with dimensions and the
download links, and all eight worked-example headings, while the practice page keeps the `noscript`
note, ten drills with answers and steps, the magic-number example, the how-to prose and 15 FAQ
rows. With JavaScript on, all 15 type × difficulty combinations produce a question, accept the
answer the engine gives, mark every field correct and print between one and six steps; a wrong
answer marks the field and still prints the steps for all five types; the same seed and index
repeat the same question while a different seed does not, and a ten-question worksheet repeats for
its seed.

- Chromium (Playwright, headless): 115 round-7 checks pass, plus the 30 round-8 checks in
  `../Subnetcalc-artifacts/2026-10-05-round8/qa-chromium.txt`. 17 pages load without JS errors; VLSM paste
  keeps three rows and flags line 2; five malformed VLSM URLs initialize cleanly; CIDR invalid
  lines disable copy and clear the clean-list claim, and fixing the list re-enables it; share
  links for the subnet calculator, VLSM, CIDR, IPv6 (including a fixed ULA), range and overlap
  tools reopen with the same result; the AWS rule sizes a 60-host request at /25 and its export
  has no warning; the GCP rule sizes a 20-host request at /27 and its export has no warning; the
  `/32` option produces a host route and round-trips in the URL; the new CloudFormation, Bicep,
  OSPF, ACL and Route exports render; the IPv6 plan counts and off-nibble note are correct; the
  IPv6 download button disables itself for oversized splits and re-enables after; IPv4 reverse
  rows appear; a saved VLSM plan survives a reload, restores the parent, stores only the query
  string and deletes cleanly; clearing `/cidr/` and the range, overlap and IPv6 plan example
  buttons keep their state across a reload; a blocked `/assets/js/analytics.js` still shows the
  consent panel and shares a plan; analytics stays silent until the consent panel's
  Allow button, then sends only sanitized page fields and referrer (stubbed gtag under a routed
  `subnetcalc.dev` origin); the three worked example pages render their pre-rendered AWS/Azure/
  IPv6 plans, and each
  CTA opens the matching planner with the same plan; every page has no horizontal overflow at 390
  CSS pixels.
- WebKit (Playwright): 19 checks pass on the round-7 set, plus the 30 round-8 checks above. The
  same pages load without errors and the input fixes, cloud rule and share URLs behave identically.
- Firefox could not be launched in this environment: macOS denied the content-process sandbox
  (`sandbox_extension_issue_file_to_process ... Operation not permitted`). This is a local
  environment limit, not a site result; a manual Firefox pass remains open.

An acceptance QA pass ran 72 Chromium checks and 15 WebKit checks against the round-3, 3.1 and 4
features: cloud reservation ranges (AWS `.4–.30`, GCP `.2–.29`), the AWS `/16` limit, export-side
provider bounds (AWS/GCP lists, CloudFormation, Bicep), GCP allocation/export/share, `/32` host
routes, all five new exports (content and file downloads), saved-plan create/load/delete with JSON
import/export and name escaping, the IPv6 download toggle including stale input, copy-failure
reporting, sanitized analytics page fields (location, title and referrer) on every event including
same-site navigation, the three example pages (pre-rendered plans, planner deep links, 390px
layout), IPv4 reverse rows, round-2 regressions and a 390px layout pass. All 87 passed;
the reports are at
`../Subnetcalc-artifacts/2026-10-03-round3/qa-report.json`, `qa-webkit.json`, `qa-chromium.txt` and
`qa-webkit.txt`.

Full Lighthouse JSON reports and browser logs are saved outside the deploy root at
`../Subnetcalc-artifacts/2026-10-03-round4/` (round 4), `../Subnetcalc-artifacts/2026-10-03-round3/`
(round 3) and `../Subnetcalc-artifacts/2026-10-03-round2/` (round 2) on this machine.

## Deployment

Production deploys are direct uploads: `npx wrangler pages deploy . --project-name=subnetcalc
--branch=main`. The project was updated on 2026-10-03 first from `22584a3` (rounds 1–6) and then
from `bd02739` (round 7). Checks after the second deploy: `/`, `/vlsm/`, `/privacy/`,
`/ipv6-subnet-plan/` and the three `/examples/...` pages return 200; `/privacy/` serves the
consent copy; and a browser context that blocks `/assets/js/analytics.js` still gets a working
consent panel and Share plan on `/vlsm/`. Before the first deploy, production still served
`1d77672`, which is why the newer pages 404ed and the privacy page was stale.

Round 8 (the cheat sheet upgrade and `/subnetting-practice/`) was uploaded on 2026-10-05 from
`658c849` as a direct upload to the same project, deployment URL
`https://1a01ec92.subnetcalc-84m.pages.dev`. Checks after the upload, read from
`https://subnetcalc.dev`: `/`, `/vlsm/`, `/subnetting-practice/`, `/learn/cidr-cheat-sheet/`,
`/privacy/` and `/ipv6-subnet-plan/` all return 200; `/subnetting-practice/` serves the new title
and loads `/assets/js/practice.js`; the cheat sheet page carries both new tables; the PDF is the
10,265-byte three-table file with the magic-number and hosts-lookup headings; `/` shows the
Practice nav item; and `sitemap.xml` lists `/subnetting-practice/`. The `/subnetting-practice/`
404 that a round-7 production served is gone.

A second upload the same day carried only the wording fix from `9c572c8` (deployment URL
`https://1b61bb67.subnetcalc-84m.pages.dev`, 5 files), and a third carried the completed
`TechArticle` markup from `3573358` (deployment URL `https://42f98871.subnetcalc-84m.pages.dev`).
After the third, the live `TechArticle` on `/learn/cidr-cheat-sheet/` reads `@type, headline,
description, image, url, mainEntityOfPage, datePublished, dateModified, inLanguage, author,
publisher`, with the `ImageObject` at 1196x994 matching both the `<img>` attributes and the PNG
header; `/learn/subnetting/` and `/learn/ipv6-subnetting/` carry the same new fields; all five pages
return 200; the PDF and PNG are unchanged at 10,265 and 83,580 bytes; the sitemap still has 17 URLs. Checked after it: a request for a missing
path serves the Learn card reading "Subnetting tutorial, subnet cheat sheet, IPv6 subnetting.";
`/cidr/` links to the sheet with the anchor "Subnet cheat sheet"; the `/learn/` description and
Open Graph description both say "a printable subnet cheat sheet"; the phrase "CIDR cheat sheet"
appears zero times across the 17 pages read from production; the practice page still serves both
pre-rendered blocks, the cheat sheet page still carries both new tables, and the PDF and PNG are
still the 10,265- and 83,580-byte files with `/subnetting-practice/` in the sitemap.

## Remaining external gates

1. The GA4 Measurement ID and Clarity Project ID are configured (round 5) and load only after
   consent. Before trusting the reports, confirm in the provider dashboards that GA4 Enhanced
   Measurement stays off and Clarity uses strict masking with its Cookie setting off, then check
   that no input or result text appears in a recording.
2. Cloudflare Pages deploys by direct upload. Cloudflare Git integration is still not connected
   (the earlier attempt returned HTTP 401 / error 8000011), so pushes to `main` do not
   auto-deploy; connect GitHub in Cloudflare to switch to Git-based continuous deployment.
3. `subnetcalc.dev` is connected to the Pages project and serves HTTPS; the GSC property and the
   sitemap submission at `https://subnetcalc.dev/sitemap.xml` remain open.
4. The GitHub repository is now public (PR #3 merge); distribution and directory submissions
   remain user-owned.
5. A human visual pass at 390, 768 and 1440 CSS pixels over the new pages is still worthwhile;
   automated width checks and Lighthouse accessibility pass, but design judgment is not automated.
   `/subnetting-practice/` and the two new cheat sheet tables have had no Lighthouse run yet, and
   `/subnetting-practice/` is the first page whose whole purpose depends on JavaScript, so the
   no-JavaScript path deserves a look beyond the pre-rendered drills.

No domain purchase, production DNS change, repository visibility change, social post or directory
submission was made; the round-8 deploy was a direct upload to the existing Pages project.
