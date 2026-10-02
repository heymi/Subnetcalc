#!/usr/bin/env python3
"""Refresh the IANA table and retain the exact CSV inputs for offline verification."""
import csv
import datetime
import hashlib
import io
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'lib/data/special-purpose.json'
SOURCES = ROOT / 'lib/data/sources'
URLS = {
    family: f'https://www.iana.org/assignments/iana-{family}-special-registry/iana-{family}-special-registry-1.csv'
    for family in ('ipv4', 'ipv6')
}


def entries(raw):
    result = []
    for row in csv.DictReader(io.StringIO(raw.decode('utf-8'))):
        reachable = row['Globally Reachable'].split()[0:1]
        reachable = True if reachable == ['True'] else False if reachable == ['False'] else None
        for block in row['Address Block'].split(','):
            result.append({
                'block': block.split()[0],
                'name': row['Name'],
                'rfc': ', '.join(f'RFC {number}' for number in re.findall(r'\[RFC(\d+)\]', row['RFC'])),
                'globallyReachable': reachable,
            })
    return result


def main():
    table = json.loads(TARGET.read_text())
    downloads = {}
    for family, url in URLS.items():
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read()
        parsed = entries(raw)
        if not parsed:
            raise ValueError(f'Empty IANA registry: {family}')
        downloads[family] = (raw, parsed)
    SOURCES.mkdir(exist_ok=True)
    table['_sources'].update(URLS)
    table['_retrieved'] = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    table['_provenance'] = 'Downloaded directly from IANA. Exact CSV snapshots and SHA-256 hashes are retained; crosscheck.py checks their fields offline.'
    table['_fields'] = 'block: CIDR; name and rfc: IANA fields; globallyReachable: IANA column (null for N/A). analyze() classifies the input address by its most specific block.'
    table['_sha256'] = {}
    for family, (raw, parsed) in downloads.items():
        (SOURCES / f'iana-{family}.csv').write_bytes(raw)
        table['_sha256'][family] = hashlib.sha256(raw).hexdigest()
        table[family] = parsed
    TARGET.write_text(json.dumps(table, indent=2, ensure_ascii=False) + '\n')
    print('IANA refreshed:', ', '.join(f'{family}={len(parsed)}' for family, (_, parsed) in downloads.items()))


if __name__ == '__main__':
    main()
