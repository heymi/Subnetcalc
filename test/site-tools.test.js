// Tests for the browser-side helpers: paste parsing, share-URL parsing, result rendering
// and the ticket-ready summaries. These run in Node against the same pure modules the
// pages load, so a broken share link or a dropped pasted line fails the suite.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analyze, planVlsm } from '../lib/subnet.js';
import { toExplain, planToText } from '../lib/export.js';
import { buildShareUrl } from '../assets/js/ui.js';
import {
  DEFAULT_REQUESTS,
  parseRequestList,
  parseVlsmSearch,
} from '../assets/js/vlsm-render.js';
import {
  DEFAULT_OVERLAP_NETS,
  parseNetworks,
  renderNets,
  renderOverlapReport,
  renderRange,
  rangeSummary,
} from '../assets/js/cidr-render.js';
import { renderResults } from '../assets/js/calc-render.js';
import { ipv6SummaryText } from '../assets/js/ipv6-render.js';

describe('VLSM paste parsing', () => {
  test('keeps every line in order and reports the unreadable one', () => {
    const r = parseRequestList('Sales 120\nEng fifty\nMgmt 10');
    assert.deepEqual(
      r.entries.map((e) => (e.error ? `!${e.line}:${e.text}` : `${e.name}:${e.hosts}`)),
      ['Sales:120', '!2:Eng fifty', 'Mgmt:10'],
    );
    assert.deepEqual(r.errors, [{ error: true, line: 2, text: 'Eng fifty' }]);
    assert.deepEqual(r.rows, [
      { name: 'Sales', hosts: 120 },
      { name: 'Mgmt', hosts: 10 },
    ]);
  });

  test('reads the common separators and host suffixes', () => {
    const r = parseRequestList('Sales,120\nEng\t50 hosts\n120 Mgmt\nP2P: 2');
    assert.deepEqual(r.rows, [
      { name: 'Sales', hosts: 120 },
      { name: 'Eng', hosts: 50 },
      { name: 'Mgmt', hosts: 120 },
      { name: 'P2P', hosts: 2 },
    ]);
    assert.equal(r.errors.length, 0);
  });

  test('blank lines are ignored, not errors', () => {
    const r = parseRequestList('\nSales 120\n\n');
    assert.equal(r.rows.length, 1);
    assert.equal(r.errors.length, 0);
  });
});

describe('VLSM share query', () => {
  test('absent query means no state', () => {
    assert.equal(parseVlsmSearch(''), null);
    assert.equal(parseVlsmSearch('?x=1'), null);
  });

  test('round-trips names and counts, keeping slashes readable', () => {
    const q = `?p=${encodeURIComponent('192.168.1.0/24').replace(/%2F/g, '/')}&r=${encodeURIComponent('Sales 120')}:120,Eng:50&s31=1`;
    const r = parseVlsmSearch(q);
    assert.equal(r.parent, '192.168.1.0/24');
    assert.equal(r.s31, true);
    assert.deepEqual(r.entries, [
      { name: 'Sales 120', hosts: 120 },
      { name: 'Eng', hosts: 50 },
    ]);
    assert.equal(r.incomplete, false);
  });

  test('malformed percent escapes never throw and are flagged', () => {
    const r = parseVlsmSearch('?p=10.0.0.0/24&r=Eng%:50,Mgmt:10');
    assert.equal(r.entries[0].name, 'Eng%');
    assert.equal(r.entries[0].hosts, 50);
    assert.deepEqual(r.bad, ['Eng%']);
  });

  test('an empty or truncated r= is reported, not fatal', () => {
    const empty = parseVlsmSearch('?r');
    assert.equal(empty.parent, '192.168.1.0/24');
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.incomplete, false);
    const missing = parseVlsmSearch('?p=10.0.0.0/24&r=Eng:');
    assert.equal(missing.incomplete, true);
    assert.equal(Number.isNaN(missing.entries[0].hosts), true);
  });
});

describe('share URLs', () => {
  test('replaces the whole query with exactly the given params', () => {
    const url = buildShareUrl('https://subnetcalc.dev/vlsm/?p=old&r=x&utm_source=nl', {
      p: '10.0.0.0/24',
      r: 'A:1',
    });
    assert.equal(url, 'https://subnetcalc.dev/vlsm/?p=10.0.0.0%2F24&r=A%3A1');
  });

  test('empty values are removed', () => {
    assert.equal(buildShareUrl('https://subnetcalc.dev/cidr/', { n: '', a: '1.1.1.1' }), 'https://subnetcalc.dev/cidr/?a=1.1.1.1');
  });
});

describe('CIDR renderers with invalid lines', () => {
  test('an invalid line blocks copying and the clean-list claim', () => {
    const r = renderNets('10.0.0.0/24\nnot-an-ip\n10.0.0.128/25');
    assert.equal(r.blocked, true);
    assert.match(r.errors, /Copying is disabled/);
    assert.match(r.errors, /Line 2:/);
    assert.match(r.ovl, /Overlap check incomplete/);
    assert.ok(!/No overlaps/.test(r.ovl));
    assert.match(r.agg, /disabled/);
    assert.match(r.sup, /disabled/);
    assert.match(r.summary, /incomplete/i);
    assert.match(r.summary, /line 2 could not be read: not-an-ip/);
  });

  test('a fully valid list keeps copying and can state no overlaps', () => {
    const r = renderNets('10.0.0.0/24\n10.0.1.0/24');
    assert.equal(r.blocked, false);
    assert.equal(r.errors, '');
    assert.match(r.ovl, /No overlaps among 2 networks/);
    assert.ok(!r.agg.includes('disabled'));
    assert.match(r.summary, /Overlaps: none/);
  });

  test('parseNetworks strips comments and keeps line numbers', () => {
    const { items, errors } = parseNetworks('10.0.0.0/24 # core\n\nbad\n10.0.1.0/24');
    assert.deepEqual(items.map((x) => [x.line, x.text]), [
      [1, '10.0.0.0/24'],
      [4, '10.0.1.0/24'],
    ]);
    assert.deepEqual(errors.map((x) => x.line), [3]);
  });

  test('overlap report counts pairs and marks an invalid list incomplete', () => {
    const ok = renderOverlapReport(DEFAULT_OVERLAP_NETS);
    assert.equal(ok.blocked, false);
    assert.equal(ok.pairs, 1);
    assert.match(ok.report, /line 1.*contains.*line 2/s);
    const bad = renderOverlapReport('10.0.0.0/24\n10.0.0.0/33');
    assert.equal(bad.blocked, true);
    assert.match(bad.report, /Incomplete/);
    assert.ok(!/No overlaps/.test(bad.report));
    assert.match(bad.summary, /incomplete/i);
  });

  test('range output and summary agree', () => {
    assert.match(renderRange('192.168.1.10', '192.168.1.20'), /4 blocks · 11 addresses/);
    const s = rangeSummary('192.168.1.10', '192.168.1.20');
    assert.match(s, /Range: 192\.168\.1\.10 - 192\.168\.1\.20/);
    assert.match(s, /192\.168\.1\.20\/32/);
    assert.equal(rangeSummary('192.168.1.20', '192.168.1.10'), null);
  });
});

describe('result hierarchy and ticket summaries', () => {
  test('primary rows come first, detail rows fold away', () => {
    const html = renderResults(analyze('192.168.1.37/26').info);
    assert.ok(html.indexOf('Usable hosts') < html.indexOf('More details'));
    assert.ok(html.indexOf('More details') < html.indexOf('Netmask'));
    assert.match(html, /<details class="more">/);
  });

  test('caller extras land in the detail fold', () => {
    const html = renderResults(analyze('2001:db8::/48').info, [{ label: 'Reverse (PTR)', value: 'x.ip6.arpa' }]);
    assert.match(html, /Reverse \(PTR\)/);
    assert.ok(html.indexOf('More details') < html.indexOf('Reverse (PTR)'));
  });

  test('toExplain includes input, result and rule', () => {
    const t = toExplain(analyze('192.168.1.37/26').info);
    assert.match(t, /^Input: 192\.168\.1\.37\/26$/m);
    assert.match(t, /^Network: 192\.168\.1\.0\/26$/m);
    assert.match(t, /Rule: \/26 = 26 network \+ 6 host bits/);
    assert.match(t, /subnetcalc\.dev/);
    assert.match(toExplain(analyze('10.0.0.0/31').info), /RFC 3021/);
  });

  test('ipv6SummaryText covers every valid tool and skips invalid ones', () => {
    const text = ipv6SummaryText(
      { addr: '2001:db8:abcd:12::1/64', mac: '00:1a:2b:3c:4d:5e', eui: 'fe80::/64', split: '2001:db8:abcd::/48', newPrefix: 52 },
      { prefix: 'fd12:3456:789a::/48', globalId: '123456789a' },
    );
    assert.match(text, /Input: 2001:db8:abcd:12::1\/64/);
    assert.match(text, /EUI-64: MAC 00:1a:2b:3c:4d:5e -> interface ID 021a:2bff:fe3c:4d5e, address fe80::21a:2bff:fe3c:4d5e/);
    assert.match(text, /Split 2001:db8:abcd::\/48 -> \/52: 16 subnets \(first 16\)/);
    assert.match(text, /ULA \/48: fd12:3456:789a::\/48 \(Global ID 123456789a\)/);
    assert.equal(ipv6SummaryText({ addr: 'bad', mac: 'bad', eui: 'bad', split: 'bad', newPrefix: 0 }, null), '');
  });

  test('planToText includes requests, allocation, free space and rule', () => {
    const plan = planVlsm('192.168.1.0/24', DEFAULT_REQUESTS).plan;
    const t = planToText(plan);
    assert.match(t, /^VLSM plan for 192\.168\.1\.0\/24$/m);
    assert.match(t, /largest request first/);
    assert.match(t, /Sales -> 192\.168\.1\.0\/25 \(192\.168\.1\.1 - 192\.168\.1\.126, broadcast 192\.168\.1\.127; 126 usable, 6 unused\)/);
    assert.match(t, /Free: 192\.168\.1\.212\/30, 192\.168\.1\.216\/29, 192\.168\.1\.224\/27/);
    assert.match(t, /4 subnets, 212 of 256 addresses allocated, 44 free/);
  });
});
