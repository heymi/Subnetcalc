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

import { planVlsm } from '../lib/subnet.js';
import {
  planToCSV,
  planToJSON,
  planToMarkdown,
  planToTerraform,
  planToAWS,
  planToAzure,
  planToCisco,
} from '../lib/export.js';

const plan = planVlsm('192.168.1.0/24', [
  { name: 'Sales', hosts: 120 },
  { name: 'Eng', hosts: 50 },
  { name: 'Mgmt', hosts: 10 },
  { name: 'P2P', hosts: 2 },
]).plan;

test('planToCSV', () => {
  assert.equal(
    planToCSV(plan),
    [
      'name,hostsRequested,cidr,netmask,firstHost,lastHost,broadcast,usableHosts,wasted',
      'Sales,120,192.168.1.0/25,255.255.255.128,192.168.1.1,192.168.1.126,192.168.1.127,126,6',
      'Eng,50,192.168.1.128/26,255.255.255.192,192.168.1.129,192.168.1.190,192.168.1.191,62,12',
      'Mgmt,10,192.168.1.192/28,255.255.255.240,192.168.1.193,192.168.1.206,192.168.1.207,14,4',
      'P2P,2,192.168.1.208/30,255.255.255.252,192.168.1.209,192.168.1.210,192.168.1.211,2,0',
      '',
    ].join('\r\n'),
  );
});

test('planToJSON', () => {
  const j = JSON.parse(planToJSON(plan));
  assert.equal(j.parent, '192.168.1.0/24');
  assert.equal(j.subnets.length, 4);
  assert.deepEqual(j.subnets[3], {
    name: 'P2P',
    hostsRequested: 2,
    cidr: '192.168.1.208/30',
    netmask: '255.255.255.252',
    firstHost: '192.168.1.209',
    lastHost: '192.168.1.210',
    broadcast: '192.168.1.211',
    usableHosts: 2,
    wasted: 0,
  });
  assert.deepEqual(j.free, ['192.168.1.212/30', '192.168.1.216/29', '192.168.1.224/27']);
  assert.equal(j.usedAddresses, 212);
  assert.equal(j.freeAddresses, 44);
});

test('planToMarkdown', () => {
  const md = planToMarkdown(plan).split('\n');
  assert.equal(md[0], '| Name | Hosts needed | Subnet | Netmask | First host | Last host | Broadcast | Usable | Unused |');
  assert.equal(md[1], '| --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |');
  assert.equal(md[2], '| Sales | 120 | 192.168.1.0/25 | 255.255.255.128 | 192.168.1.1 | 192.168.1.126 | 192.168.1.127 | 126 | 6 |');
  assert.ok(md.includes('Free: 192.168.1.212/30, 192.168.1.216/29, 192.168.1.224/27'));
});

test('planToTerraform uses cidrsubnet with correct newbits/netnum', () => {
  assert.equal(
    planToTerraform(plan),
    `# VLSM plan for 192.168.1.0/24
locals {
  base_cidr = "192.168.1.0/24"

  subnets = {
    "Sales" = cidrsubnet(local.base_cidr, 1, 0) # 192.168.1.0/25
    "Eng"   = cidrsubnet(local.base_cidr, 2, 2) # 192.168.1.128/26
    "Mgmt"  = cidrsubnet(local.base_cidr, 4, 12) # 192.168.1.192/28
    "P2P"   = cidrsubnet(local.base_cidr, 6, 52) # 192.168.1.208/30
  }
}
`,
  );
});

test('planToTerraform escapes HCL strings', () => {
  const p = planVlsm('10.0.0.0/24', [{ name: 'a "b" ${c}', hosts: 10 }]).plan;
  assert.match(planToTerraform(p), /"a \\"b\\" \$\$\{c\}" = cidrsubnet/);
});

test('planToTerraform preserves all subnets with duplicate names and suffix collisions', () => {
  const p = planVlsm('10.0.0.0/24', [
    { name: 'Sales', hosts: 50 },
    { name: 'Sales', hosts: 10 },
    { name: 'Sales (2)', hosts: 2 },
  ]).plan;
  const tf = planToTerraform(p);
  const keys = [...tf.matchAll(/^\s+"([^"]+)"\s+= cidrsubnet/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ['Sales', 'Sales (3)', 'Sales (2)']);
  assert.equal(new Set(keys).size, p.allocations.length);
});

test('planToAWS and planToAzure warn about provider limits', () => {
  const aws = planToAWS(plan);
  assert.match(aws, /^192\.168\.1\.0\/25 {4}# Sales \(120 hosts\)$/m);
  assert.match(aws, /192\.168\.1\.192\/28 {2}# Mgmt \(10 hosts\)$/m);
  assert.match(aws, /192\.168\.1\.208\/30 {2}# P2P \(2 hosts\) WARNING: \/30 is smaller than the AWS minimum \/28/);
  const tight = planVlsm('10.0.0.0/24', [{ name: 'Edge', hosts: 60 }]).plan; // /26: 64 - 5 = 59 < 60
  assert.match(planToAWS(tight), /Edge \(60 hosts\) WARNING: only 59 usable after AWS reserves 5/);
  const az = planToAzure(plan);
  assert.match(az, /P2P \(2 hosts\) WARNING: \/30 is smaller than the Azure minimum \/29/);
  assert.match(az, /Mgmt \(10 hosts\)$/m);
});

test('planToCisco', () => {
  const c = planToCisco(plan).split('\n');
  assert.deepEqual(c.slice(0, 5), [
    '! Sales: 192.168.1.0/25, 126 usable',
    'interface <INTERFACE>',
    ' description Sales',
    ' ip address 192.168.1.1 255.255.255.128',
    '!',
  ]);
  const p31 = planVlsm('10.0.0.0/30', [{ name: 'Link', hosts: 2 }], { allowSlash31: true }).plan;
  assert.ok(planToCisco(p31).includes(' ip address 10.0.0.0 255.255.255.254'));
});
