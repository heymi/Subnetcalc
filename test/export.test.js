import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../lib/subnet.js';
import { toText, toJSON, toCSV } from '../lib/export.js';

const info = (s) => analyze(s).info;

test('toText: IPv4', () => {
  assert.equal(
    toText(info('192.168.1.37/26')),
    [
      'Address:               192.168.1.37',
      'Network:               192.168.1.0/26',
      'Netmask:               255.255.255.192',
      'Wildcard:              0.0.0.63',
      'Prefix length:         26',
      'Broadcast:             192.168.1.63',
      'First usable host:     192.168.1.1',
      'Last usable host:      192.168.1.62',
      'Usable hosts:          62',
      'Total addresses:       64',
      'Class:                 C',
      'Special-purpose block: Private-Use (192.168.0.0/16, RFC 1918)',
      'Globally reachable:    no',
      '',
    ].join('\n'),
  );
});

test('toText: /31 has no broadcast line', () => {
  const t = toText(info('10.0.0.0/31'));
  assert.ok(!t.includes('Broadcast'));
  assert.match(t, /Usable hosts:\s+2\n/);
});

test('toText: IPv6 with embedded IPv4', () => {
  const t = toText(info('2001:0:4136:e378:8000:63bf:3fff:fdd2'));
  assert.match(t, /IPv6 type:\s+teredo\n/);
  assert.match(t, /Embedded IPv4:\s+Teredo server 65\.54\.227\.120, client 192\.0\.2\.45, port 40000\n/);
  assert.ok(!t.includes('Class'));
});

test('toJSON: BigInt as strings, round-trips through JSON.parse', () => {
  const j = JSON.parse(toJSON(info('2001:db8::/48')));
  assert.equal(j.totalAddresses, '1208925819614629174706176');
  assert.equal(j.slash64Count, '65536');
  assert.equal(j.cidr, '2001:db8::/48');
  assert.equal(j.parsed, undefined);
  assert.deepEqual(j.special, { block: '2001:db8::/32', name: 'Documentation', rfc: 'RFC 3849', globallyReachable: false });
});

test('toCSV: header, CRLF, quoting', () => {
  const c = toCSV(info('192.0.0.170/32'));
  const lines = c.split('\r\n');
  assert.equal(lines[0], 'field,value');
  assert.equal(lines.at(-1), '');
  assert.ok(lines.includes('cidr,192.0.0.170/32'));
  // name and RFC list contain a comma, so the cell is quoted
  assert.ok(lines.includes('special,"NAT64/DNS64 Discovery (192.0.0.170/32, RFC 8880, RFC 7050)"'));
});
