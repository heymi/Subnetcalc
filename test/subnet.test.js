// Tests for lib/subnet.js. Expected values live in test/vectors/*.json, shared with
// test/vectors/crosscheck.py, which re-verifies every vector against independent tools
// (CPython ipaddress, netaddr, sipcalc, ipcalc, ipv6calc).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SubnetError,
  parseAddress,
  parseCidr,
  formatAddress,
  formatCidr,
  networkOf,
  prefixToMask,
  maskToPrefix,
  analyze,
  binaryBreakdown,
  requiredPrefix,
  planVlsm,
  cidrsubnetArgs,
  supernet,
  aggregate,
  findOverlaps,
  rangeToCidrs,
  prefixTable,
  split,
  contains,
  overlaps,
  compareCidr,
  expandIPv6,
  compressIPv6,
  eui64InterfaceId,
  eui64Address,
  generateUla,
} from '../lib/subnet.js';

const vectors = (name) => JSON.parse(readFileSync(new URL(`./vectors/${name}`, import.meta.url), 'utf8'));

// BigInt -> decimal string so results compare against JSON vectors.
const plain = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

test('every shared vector records at least two independent validators and references', () => {
  for (const file of ['analyze-ipv4.json', 'analyze-ipv6.json', 'binary.json', 'cidr-ops.json', 'errors.json', 'ipv6-format.json', 'ipv6-tools.json', 'prefix-table-ipv4.json', 'vlsm.json']) {
    const data = vectors(file);
    const rows = Array.isArray(data) ? data : Object.values(data).flat();
    for (const row of rows) {
      assert.ok(row.source?.references.length, `${file}: missing references`);
      assert.ok(new Set(row.source.validators.map((v) => v.tool)).size >= 2, `${file}: missing validators`);
      for (const v of row.source.validators) assert.ok(v.version && v.checks.length);
    }
  }
});

function assertCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof SubnetError, `expected SubnetError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

describe('analyze: IPv4 vectors', () => {
  for (const v of vectors('analyze-ipv4.json')) {
    test(`${JSON.stringify(v.input)}${v.options ? ' ' + JSON.stringify(v.options) : ''} — ${v.note}`, () => {
      const r = analyze(v.input, v.options);
      assert.equal(r.ok, true, r.error && r.error.message);
      const info = plain(r.info);
      for (const [k, want] of Object.entries(v.expect)) assert.deepEqual(info[k], want, k);
      assert.equal(info.ipv6Type, null);
      assert.equal(info.embedded, null);
      assert.equal(info.slash64, null);
    });
  }
});

describe('analyze: IPv6 vectors', () => {
  for (const v of vectors('analyze-ipv6.json')) {
    test(`${v.input} — ${v.note}`, () => {
      const r = analyze(v.input, v.options);
      assert.equal(r.ok, true, r.error && r.error.message);
      const info = plain(r.info);
      for (const [k, want] of Object.entries(v.expect)) assert.deepEqual(info[k], want, k);
    });
  }
});

describe('analyze: invalid and incomplete input', () => {
  for (const v of vectors('errors.json')) {
    test(`${JSON.stringify(v.input)} -> ${v.code}`, () => {
      const r = analyze(v.input);
      assert.equal(r.ok, false);
      assert.equal(r.error.code, v.code);
      assert.equal(typeof r.error.message, 'string');
      assert.ok(r.error.message.length > 0);
      assertCode(() => parseCidr(v.input), v.code);
    });
  }

  test('never throws on arbitrary input', () => {
    const samples = ['/', '.', ':', '::/', '%', '1.2.3.4 ', '1.2.3.4  255.0.0.0', '\t\n', '::ffff:1.2.3', '1..2.3',
      'ffff::ffff::', '2001:db8::/0x40', '255.255.255.255/32/', '0x0a.0.0.1', '١٢٣.1.1.1', '1.2.3.4/٢٤'];
    let seed = 42;
    const chars = '0123456789abcdefABCDEF.:/% x-';
    for (let i = 0; i < 2000; i++) {
      let s = '';
      const len = (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 24;
      for (let j = 0; j < len; j++) s += chars[(seed = (seed * 1103515245 + 12345) % 2 ** 31) % chars.length];
      samples.push(s);
    }
    for (const s of samples) {
      const r = analyze(s);
      assert.equal(typeof r.ok, 'boolean', s);
      if (!r.ok) assert.equal(typeof r.error.code, 'string', s);
    }
  });
});

describe('masks and the /0–/32 table', () => {
  const table = vectors('prefix-table-ipv4.json').map(({ source, ...row }) => row);
  test('prefixTable(4) matches vectors', () => {
    assert.deepEqual(plain(prefixTable(4)), table);
  });
  for (const row of table) {
    test(`/${row.prefix} mask round-trip`, () => {
      const mask = prefixToMask(row.prefix, 4);
      assert.equal(formatAddress(mask, 4), row.netmask);
      assert.equal(maskToPrefix(row.netmask, 4), row.prefix);
      assert.equal(maskToPrefix(mask, 4), row.prefix);
    });
  }
  test('IPv6 masks', () => {
    assert.equal(formatAddress(prefixToMask(64, 6), 6), 'ffff:ffff:ffff:ffff::');
    assert.equal(formatAddress(prefixToMask(0, 6), 6), '::');
    assert.equal(maskToPrefix(prefixToMask(48, 6), 6), 48);
  });
  test('non-contiguous mask is rejected', () => {
    assertCode(() => maskToPrefix('255.0.255.0', 4), 'NON_CONTIGUOUS_MASK');
    assertCode(() => maskToPrefix('0.0.0.255', 4), 'NON_CONTIGUOUS_MASK');
  });
  test('prefix out of range', () => {
    assertCode(() => prefixToMask(33, 4), 'INVALID_PREFIX');
    assertCode(() => prefixToMask(-1, 6), 'INVALID_PREFIX');
  });
});

describe('IPv6 text form (RFC 5952)', () => {
  for (const v of vectors('ipv6-format.json')) {
    test(`${v.input} — ${v.note}`, () => {
      assert.equal(compressIPv6(v.input), v.compressed);
      assert.equal(expandIPv6(v.input), v.expanded);
      const a = parseAddress(v.input);
      assert.equal(a.version, 6);
      assert.equal(formatAddress(a.value, 6), v.compressed);
      assert.equal(formatAddress(a.value, 6, { expanded: true }), v.expanded);
    });
  }
});

describe('binaryBreakdown', () => {
  for (const v of vectors('binary.json')) {
    test(v.input, () => {
      const b = binaryBreakdown(parseCidr(v.input));
      const groupSize = v.input.includes(':') ? 16 : 8;
      const sep = groupSize === 16 ? ':' : '.';
      const join = (bits) => {
        let s = '';
        bits.forEach((x, i) => {
          if (i && i % groupSize === 0) s += sep;
          s += x.bit;
        });
        return s;
      };
      assert.equal(join(b.address), v.address);
      assert.equal(join(b.mask), v.mask);
      assert.equal(join(b.network), v.network);
      for (const bits of [b.address, b.mask, b.network]) {
        assert.equal(bits.length, groupSize === 16 ? 128 : 32);
        bits.forEach((x, i) => {
          assert.equal(x.index, i);
          assert.equal(x.isNetwork, i < v.prefix);
          assert.equal(x.group, Math.floor(i / groupSize));
          assert.equal(x.weight, 2 ** (groupSize - 1 - (i % groupSize)));
        });
      }
    });
  }
});

describe('CIDR operations', () => {
  const ops = vectors('cidr-ops.json');
  for (const v of ops.aggregate) {
    test(`aggregate ${v.input.join(', ')}`, () => {
      assert.deepEqual(aggregate(v.input).map(formatCidr), v.expect);
    });
  }
  for (const v of ops.supernet) {
    test(`supernet ${v.input.join(', ')}`, () => {
      assert.equal(formatCidr(supernet(v.input)), v.expect);
    });
  }
  for (const v of ops.findOverlaps) {
    test(`findOverlaps ${v.input.join(', ')}`, () => {
      assert.deepEqual(findOverlaps(v.input), v.expect);
    });
  }
  for (const v of ops.rangeToCidrs) {
    test(`rangeToCidrs ${v.start} - ${v.end}`, () => {
      assert.deepEqual(rangeToCidrs(v.start, v.end).map(formatCidr), v.expect);
    });
  }
  for (const v of ops.split) {
    test(`split ${v.input} -> /${v.newPrefix}`, () => {
      assert.deepEqual(split(v.input, v.newPrefix, { limit: v.limit ?? v.expect.length }).map(formatCidr), v.expect);
    });
  }
  for (const v of ops.cidrsubnetArgs) {
    test(`cidrsubnetArgs ${v.parent} ${v.child} — ${v.note}`, () => {
      assert.deepEqual(cidrsubnetArgs(v.parent, v.child), v.expect);
    });
  }
  for (const v of ops.errors) {
    test(`${v.op} error ${v.code}`, () => {
      const call = {
        aggregate: () => aggregate(v.input),
        supernet: () => supernet(v.input),
        rangeToCidrs: () => rangeToCidrs(v.start, v.end),
        split: () => split(v.input, v.newPrefix, v.limit === undefined ? undefined : { limit: v.limit }),
        cidrsubnetArgs: () => cidrsubnetArgs(v.parent, v.child),
      }[v.op];
      assertCode(call, v.code);
    });
  }

  test('contains / overlaps / compareCidr', () => {
    assert.equal(contains('10.0.0.0/8', '10.1.0.0/16'), true);
    assert.equal(contains('10.1.0.0/16', '10.0.0.0/8'), false);
    assert.equal(contains('10.0.0.0/8', '10.255.255.255'), true);
    assert.equal(contains('10.0.0.0/8', '2001:db8::/32'), false);
    assert.equal(overlaps('10.0.0.0/8', '10.1.0.0/16'), true);
    assert.equal(overlaps('10.0.0.0/16', '10.1.0.0/16'), false);
    const sorted = ['10.0.1.0/24', '2001:db8::/32', '10.0.0.0/16', '10.0.0.0/24', '9.0.0.0/8']
      .map((s) => parseCidr(s))
      .sort(compareCidr)
      .map(formatCidr);
    assert.deepEqual(sorted, ['9.0.0.0/8', '10.0.0.0/16', '10.0.0.0/24', '10.0.1.0/24', '2001:db8::/32']);
  });

  test('split requires an explicit positive, finite limit', () => {
    assertCode(() => split('2001:db8::/48', 64), 'INVALID_LIMIT');
    for (const limit of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assertCode(() => split('10.0.0.0/24', 26, { limit }), 'INVALID_LIMIT');
    }
    assertCode(() => split('10.0.0.0/8', 32, { limit: 65536 }), 'TOO_MANY');
    assert.equal(split('10.0.0.0/8', 24, { limit: 65536 }).length, 65536);
  });

  test('aggregate(split(x)) round-trips', () => {
    for (const s of ['10.0.0.0/8', '192.168.4.0/22', '2001:db8:40::/42', '0.0.0.0/0']) {
      const n = parseCidr(s);
      const parts = split(n, Math.min(n.prefix + 6, n.version === 4 ? 32 : 128), { limit: 64 });
      assert.deepEqual(aggregate(parts).map(formatCidr), [s]);
      assert.equal(formatCidr(supernet(parts)), s);
    }
  });
});

describe('parsing details', () => {
  test('scope and IPv6 type describe the input address even with a broad prefix', () => {
    assert.equal(analyze('192.168.1.1/8').info.special.block, '192.168.0.0/16');
    assert.equal(analyze('10.1.2.3/0').info.special.block, '10.0.0.0/8');
    assert.equal(analyze('fd12:3456::1/0').info.ipv6Type, 'ULA');
    assert.equal(analyze('fd12:3456::1/0').info.special.block, 'fc00::/7');
  });
  test('IANA RFC 9780 dummy prefix is recognized', () => {
    const info = analyze('100:0:0:1::1/64').info;
    assert.equal(info.special.block, '100:0:0:1::/64');
    assert.equal(info.special.rfc, 'RFC 9780');
    assert.equal(info.special.globallyReachable, false);
  });
  test('parseCidr keeps host bits; networkOf clears them', () => {
    const c = parseCidr('192.168.1.37/26');
    assert.equal(formatCidr(c), '192.168.1.37/26');
    assert.equal(formatCidr(networkOf(c)), '192.168.1.0/26');
  });
  test('zone id is kept on the address', () => {
    const a = parseAddress('fe80::1%eth0');
    assert.equal(a.zone, 'eth0');
    assert.equal(formatAddress(a.value, 6), 'fe80::1');
  });
  test('maskAs only matters for ambiguous masks', () => {
    const r = analyze('10.1.2.3 0.0.0.0', { maskAs: 'wildcard' });
    assert.equal(r.info.prefix, 32);
    assert.equal(r.info.interpretedAs, 'wildcard');
    assert.equal(r.info.maskAmbiguous, true);
    const r2 = analyze('10.1.2.3 0.0.255.255', { maskAs: 'mask' });
    assert.equal(r2.info.prefix, 16);
    assert.equal(r2.info.interpretedAs, 'wildcard');
    assert.equal(r2.info.maskAmbiguous, false);
  });
  test('prefix notation leaves interpretedAs null', () => {
    assert.equal(analyze('10.0.0.0/8').info.interpretedAs, null);
    assert.equal(analyze('10.0.0.1').info.interpretedAs, null);
  });
  test('SubnetError carries code and input', () => {
    try {
      parseCidr('10.0.0.0/40');
      assert.fail('should throw');
    } catch (e) {
      assert.ok(e instanceof SubnetError);
      assert.ok(e instanceof Error);
      assert.equal(e.code, 'INVALID_PREFIX');
      assert.equal(e.input, '10.0.0.0/40');
    }
  });
});

describe('VLSM', () => {
  const d = vectors('vlsm.json');
  for (const v of d.requiredPrefix) {
    test(`requiredPrefix(${v.hosts}${v.allowSlash31 ? ', /31 allowed' : ''}) = /${v.expect}`, () => {
      assert.equal(requiredPrefix(v.hosts, { allowSlash31: !!v.allowSlash31 }), v.expect);
    });
  }
  for (const v of d.requiredPrefixErrors) {
    test(`requiredPrefix(${v.hosts}) -> ${v.code}`, () => {
      assertCode(() => requiredPrefix(v.hosts), v.code);
    });
  }
  for (const v of d.plans) {
    test(`planVlsm ${v.parent} — ${v.note}`, () => {
      const r = planVlsm(v.parent, v.requests, v.options);
      if (!v.expect.ok) {
        assert.equal(r.ok, false);
        const { message, ...rest } = r.error;
        assert.deepEqual(plain(rest), v.expect.error);
        assert.ok(message);
        return;
      }
      assert.equal(r.ok, true, r.error && r.error.message);
      const plan = r.plan;
      const got = plain(plan.allocations).map((a) => {
        const out = {};
        for (const k of Object.keys(v.expect.allocations[0])) out[k] = a[k];
        return out;
      });
      assert.deepEqual(got, v.expect.allocations);
      assert.deepEqual(plan.free.map(formatCidr), v.expect.free);
      assert.equal(String(plan.usedAddresses), v.expect.usedAddresses);
      assert.equal(String(plan.freeAddresses), v.expect.freeAddresses);
      assert.equal(formatCidr(plan.parent), formatCidr(networkOf(parseCidr(v.parent))));

      // tree: leaves are exactly the allocations and the free blocks, each node halves its parent
      const allocated = [];
      const free = [];
      const walk = (node) => {
        if (node.state === 'split') {
          assert.equal(node.children.length, 2);
          for (const ch of node.children) {
            assert.equal(ch.cidr.prefix, node.cidr.prefix + 1);
            assert.ok(contains(node.cidr, ch.cidr));
            walk(ch);
          }
        } else {
          assert.equal(node.children, undefined);
          (node.state === 'allocated' ? allocated : free).push(node);
        }
      };
      walk(plan.tree);
      assert.equal(formatCidr(plan.tree.cidr), formatCidr(plan.parent));
      assert.deepEqual(allocated.map((n) => n.name).sort(), v.expect.allocations.map((a) => a.name).sort());
      assert.deepEqual(
        allocated.map((n) => formatCidr(n.cidr)).sort(),
        v.expect.allocations.map((a) => a.cidr).sort(),
      );
      assert.deepEqual(aggregate(free.map((n) => n.cidr)).map(formatCidr), aggregate(v.expect.free).map(formatCidr));
    });
  }
  for (const v of d.errors) {
    test(`planVlsm ${v.parent} -> ${v.code}`, () => {
      const r = planVlsm(v.parent, v.requests);
      assert.equal(r.ok, false);
      assert.equal(r.error.code, v.code);
    });
  }
});

describe('capacity rules (application policy)', () => {
  test('reservedHosts and minPrefix change requiredPrefix', () => {
    assert.equal(requiredPrefix(60), 26);
    assert.equal(requiredPrefix(60, { reservedHosts: 5, minPrefix: 28 }), 25);
    assert.equal(requiredPrefix(1, { reservedHosts: 5, minPrefix: 28 }), 28);
    assert.equal(requiredPrefix(1, { reservedHosts: 5, minPrefix: 29 }), 29);
    assert.equal(requiredPrefix(2, { allowSlash31: true }), 31);
    assert.equal(requiredPrefix(2, { allowSlash31: true, reservedHosts: 5, minPrefix: 28 }), 28);
  });
  test('invalid reservation values are rejected', () => {
    assertCode(() => requiredPrefix(1, { reservedHosts: -1 }), 'INVALID_RESERVATION');
    assertCode(() => requiredPrefix(1, { reservedHosts: 1.5 }), 'INVALID_RESERVATION');
    assertCode(() => requiredPrefix(1, { minPrefix: 33 }), 'INVALID_RESERVATION');
  });
  test('/32 single-host option', () => {
    assert.equal(requiredPrefix(1, { allowSlash32: true }), 32);
    assert.equal(requiredPrefix(2, { allowSlash32: true }), 30);
    assert.equal(requiredPrefix(1, { allowSlash31: true, allowSlash32: true }), 32);
    assert.equal(requiredPrefix(2, { allowSlash31: true, allowSlash32: true }), 31);
    // cloud rules keep their minimum even when /32 is requested
    assert.equal(requiredPrefix(1, { allowSlash32: true, reservedHosts: 5, minPrefix: 28 }), 28);
  });
  test('planVlsm allocates a /32 host route with no broadcast', () => {
    const p = planVlsm(
      '10.0.0.0/30',
      [
        { name: 'Lo0', hosts: 1 },
        { name: 'Link', hosts: 2 },
      ],
      { allowSlash31: true, allowSlash32: true },
    ).plan;
    assert.deepEqual(
      p.allocations.map((a) => [a.name, a.cidr, a.prefix]),
      [
        ['Link', '10.0.0.0/31', 31],
        ['Lo0', '10.0.0.2/32', 32],
      ],
    );
    const lo = p.allocations[1];
    assert.equal(String(lo.usableHosts), '1');
    assert.equal(lo.broadcast, null);
    assert.equal(lo.firstHost, '10.0.0.2');
    assert.equal(lo.lastHost, '10.0.0.2');
    assert.deepEqual(p.free.map(formatCidr), ['10.0.0.3/32']);
  });
  test('planVlsm records and applies the provider rule', () => {
    const p = planVlsm('10.0.0.0/24', [{ name: 'Edge', hosts: 60 }], {
      reservedHosts: 5,
      reserveHead: 4,
      reserveTail: 1,
      minPrefix: 28,
      maxPrefix: 16,
      provider: 'aws',
    }).plan;
    assert.equal(p.allocations[0].prefix, 25);
    assert.equal(String(p.allocations[0].usableHosts), '123');
    assert.equal(String(p.allocations[0].wasted), '63');
    assert.equal(p.reservedHosts, 5);
    assert.equal(p.reserveHead, 4);
    assert.equal(p.reserveTail, 1);
    assert.equal(p.minPrefix, 28);
    assert.equal(p.maxPrefix, 16);
    assert.equal(p.provider, 'aws');
    const generic = planVlsm('10.0.0.0/24', [{ name: 'Edge', hosts: 60 }]).plan;
    assert.equal(generic.allocations[0].prefix, 26);
    assert.equal(generic.provider, null);
  });
  test('reservation positions drive the first and last usable address', () => {
    const plan = (opts) => planVlsm('10.0.0.0/24', [{ name: 'Edge', hosts: 20 }], opts).plan.allocations[0];
    const generic = plan({});
    assert.deepEqual([generic.firstHost, generic.lastHost, String(generic.usableHosts)], ['10.0.0.1', '10.0.0.30', '30']);
    const aws = plan({ reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 28, maxPrefix: 16, provider: 'aws' });
    assert.equal(aws.cidr, '10.0.0.0/27');
    assert.deepEqual([aws.firstHost, aws.lastHost, String(aws.usableHosts)], ['10.0.0.4', '10.0.0.30', '27']);
    const azure = plan({ reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 29, provider: 'azure' });
    assert.deepEqual([azure.firstHost, azure.lastHost], ['10.0.0.4', '10.0.0.30']);
    const gcp = plan({ reservedHosts: 4, reserveHead: 2, reserveTail: 2, minPrefix: 29, provider: 'gcp' });
    assert.deepEqual([gcp.firstHost, gcp.lastHost, String(gcp.usableHosts)], ['10.0.0.2', '10.0.0.29', '28']);
  });
  test('AWS maximum subnet /16 rejects requests that would need a larger block', () => {
    const aws = { reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 28, maxPrefix: 16, provider: 'aws' };
    assertCode(() => requiredPrefix(70000, aws), 'PROVIDER_LIMIT');
    const r = planVlsm('10.0.0.0/8', [{ name: 'Big', hosts: 70000 }], aws);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'PROVIDER_LIMIT');
    assert.match(r.error.message, /maximum subnet \/16/);
    assert.match(r.error.message, /"Big"/);
    const fits = planVlsm('10.0.0.0/8', [{ name: 'Big', hosts: 65531 }], aws).plan.allocations[0];
    assert.equal(fits.prefix, 16);
    assert.equal(fits.firstHost, '10.0.0.4');
    assert.equal(fits.lastHost, '10.0.255.254');
  });
  test('a reservation layout that does not add up is rejected', () => {
    assertCode(() => requiredPrefix(1, { reservedHosts: 5, reserveHead: 2, reserveTail: 2 }), 'INVALID_RESERVATION');
    assertCode(() => requiredPrefix(1, { reservedHosts: 2, reserveHead: -1, reserveTail: 3 }), 'INVALID_RESERVATION');
  });
});

describe('IPv6 tools', () => {
  const d = vectors('ipv6-tools.json');
  for (const v of d.eui64) {
    test(`EUI-64 ${v.mac} — ${v.note}`, () => {
      assert.equal(eui64InterfaceId(v.mac), v.interfaceId);
      assert.equal(eui64Address(v.prefix, v.mac), v.address);
    });
  }
  for (const v of d.eui64Errors) {
    test(`EUI-64 error ${v.mac} ${v.prefix || ''} -> ${v.code}`, () => {
      assertCode(() => (v.prefix ? eui64Address(v.prefix, v.mac) : eui64InterfaceId(v.mac)), v.code);
    });
  }
  for (const v of d.ula) {
    test(`ULA from ${v.randomBytes}`, () => {
      const bytes = Uint8Array.from(v.randomBytes.match(/../g).map((h) => parseInt(h, 16)));
      const got = generateUla({ randomBytes: (n) => (assert.equal(n, 5), bytes) });
      assert.deepEqual(got, v.expect);
    });
  }
  test('ULA default uses crypto randomness', () => {
    const a = generateUla();
    const b = generateUla();
    assert.match(a.globalId, /^[0-9a-f]{10}$/);
    assert.notEqual(a.globalId, b.globalId);
    const info = analyze(a.prefix).info;
    assert.equal(info.ipv6Type, 'ULA');
    assert.equal(info.prefix, 48);
    assert.equal(info.hostBitsSet, false);
    assert.equal(expandIPv6(info.network).replaceAll(':', '').slice(0, 12), 'fd' + a.globalId);
  });
});
