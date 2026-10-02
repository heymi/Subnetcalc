# Shared test vectors

The Node tests and `crosscheck.py` read these same nine JSON files (232 vectors).
Each vector's `source` lists references and the independent tools, versions and
fields actually checked. A tool is not claimed to verify fields absent from its
`checks` list. RFC links document the rules; not every input is a verbatim RFC example.

```sh
python3.13 -m pip install netaddr==1.3.0
# Debian/Ubuntu: sudo apt-get install sipcalc ipcalc ipv6calc
npm run crosscheck
python3.13 test/vectors/crosscheck.py --record-provenance
```

Every vector must have at least two available validators. Recording updates only
`source` metadata, and only after all comparisons pass. It never replaces expected
results with outputs from SubnetCalc. The verification run used Python 3.13.15,
netaddr 1.3.0, Perl ipcalc 0.51 and ipv6calc 4.4.0; sipcalc was not needed locally.

## Explicit semantic differences

- IPv6 counts the complete range as usable, including the subnet-router anycast
  address. Python's `hosts()` differs; we compare its network range instead.
- `/31` is enabled for IPv4 point-to-point calculations (RFC 3021). VLSM allocates
  `/30` for two hosts unless `allowSlash31` is selected.
- VLSM is IPv4-only, masks win ambiguous mask/wildcard inputs, and `split()` requires
  an explicit limit. These are application policies. For policy errors, tools
  validate address family, prefix, ordering or capacity; they do not emit our error codes.
- netaddr accepts reversed range endpoints; the checker validates their ordering
  explicitly. SubnetCalc rejects them.
- New IANA allocations can predate Python's bundled reachability table. Exceptions
  are named in `KNOWN_DIFFS`; IANA CSV snapshots are authoritative for registry fields.

## Refreshing IANA

```sh
python3 scripts/refresh-special-purpose.py
npm run build
npm run check
npm run crosscheck
```

The refresh preserves the original CSV bytes in `lib/data/sources/`, records UTC
retrieval date and SHA-256 hashes, and keeps supplementary blocks separate. The
checker verifies all JSON registry fields against those snapshots offline.
