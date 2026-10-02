# subnetcalc

IPv4 and IPv6 subnet math for the browser and Node: parsing, subnet details, binary breakdown,
VLSM planning, CIDR aggregation, overlap detection, range-to-CIDR, EUI-64 and ULA generation.
It has no dependencies and uses BigInt for every address.

It is the engine behind [subnetcalc.dev](https://subnetcalc.dev).

```js
import { analyze, planVlsm, aggregate, formatCidr } from 'subnetcalc';

analyze('192.168.1.37/26').info;
// { network: '192.168.1.0', broadcast: '192.168.1.63', firstHost: '192.168.1.1',
//   usableHosts: 62n, wildcard: '0.0.0.63', special: { name: 'Private-Use', rfc: 'RFC 1918', … }, … }

planVlsm('192.168.1.0/24', [
  { name: 'Sales', hosts: 120 },
  { name: 'Eng', hosts: 50 },
]).plan.allocations.map((a) => a.cidr);
// [ '192.168.1.0/25', '192.168.1.128/26' ]

aggregate(['10.0.0.0/24', '10.0.1.0/24']).map(formatCidr);
// [ '10.0.0.0/23' ]
```

## Input forms

`analyze()` and `parseCidr()` accept:

| Input | Meaning |
| --- | --- |
| `192.168.1.0/24` | prefix length |
| `192.168.1.0 255.255.255.0` or `192.168.1.0/255.255.255.0` | netmask |
| `10.0.0.0 0.0.255.255` | wildcard (ACL style), detected automatically |
| `192.168.1.1` | bare address = /32 (IPv6: /128) |
| `2001:db8::/48`, `fe80::1%eth0/64`, `::ffff:192.0.2.1` | every RFC 4291 IPv6 form |

`0.0.0.0` and `255.255.255.255` are valid both as a netmask and as a wildcard. They are read as a
netmask, and the result has `maskAmbiguous: true`. Pass `{ maskAs: 'wildcard' }` to read them as a wildcard instead.

## Behaviour notes

- **/31** follows RFC 3021: 2 usable hosts, no broadcast. **/32** has 1 host.
- **IPv6** has no broadcast. Every address counts as usable, so the first host is the network address.
- **VLSM** assigns the largest request first (ties keep input order), packs from the start of the
  parent, and gives 2 hosts a /30 unless `allowSlash31` is set. Only IPv4 is supported.
- **Special-purpose** data comes from the IANA registries and lives in
  [`lib/data/special-purpose.json`](lib/data/special-purpose.json), with source URLs and the retrieval date.
- IPv6 output follows RFC 5952, with mixed notation for IPv4-mapped addresses.

## Exports

`subnetcalc/export` formats results as text, JSON (BigInt values become strings) and CSV.

## Website

The site is static HTML, CSS and vanilla JS in this repository (`index.html`, `vlsm/`, `cidr/`, `ipv6/`,
`learn/`, `assets/`). There is no build step at deploy time. `scripts/build.mjs` keeps the shared header,
footer and pre-rendered results inside the committed HTML in sync. Run it after you edit a partial or a renderer.

```sh
python3 -m http.server 8080          # serve the repo root locally
node scripts/build.mjs               # refresh partials, pre-rendered blocks and sitemap.xml
node scripts/check-site.mjs          # SEO tags, links, anchors, JSON-LD, FAQ schema, wording rules
```

Cloudflare Pages setup:

- **Build command:** `npm test && node scripts/check-site.mjs`. A red test or site check stops the deploy.
- **Output directory:** `/`
- `_headers` sets caching and security headers. `_redirects` returns 404 for `/test/`, `/scripts/` and `/.github/`.

Analytics: GA4 and Clarity load only on `subnetcalc.dev`, and only once the page is idle. They stay off until
the IDs in `assets/js/common.js` are filled in.

## Tests

```sh
npm test               # node:test, reads test/vectors/*.json
npm run crosscheck     # re-verifies every vector with CPython ipaddress, netaddr, sipcalc, ipcalc, ipv6calc
```

The test vectors come from RFC examples and real-world cases. Each one must be confirmed by at least two
independent tools before it is accepted. `crosscheck.py` documents where those tools disagree with each
other, or with SubnetCalc's chosen semantics, and why.

## License

MIT
