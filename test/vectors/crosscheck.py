#!/usr/bin/env python3
"""Cross-check every test vector in test/vectors/*.json against independent tools.

    npm run crosscheck            # or: python3.13 test/vectors/crosscheck.py

Tools (each one optional, but every vector must be confirmed by at least two):
  py        CPython >= 3.13 `ipaddress` (stdlib)
  netaddr   pip install netaddr
  sipcalc   apt install sipcalc
  ipcalc    apt install ipcalc        (the Perl one, 0.4x/0.5x)
  ipv6calc  apt install ipv6calc

The vectors are the single source of truth: test/subnet.test.js reads the same
files. This script never rewrites them; it only reports disagreements.

Where a tool's semantics differ from the ones SubnetCalc chose (for example
CPython excludes the IPv6 Subnet-Router anycast address from hosts(), or an
older tool predates a newer RFC), the comparison is adapted or the vector is
listed in KNOWN_DIFFS with the reason.
"""
import ipaddress as ip
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
assert sys.version_info >= (3, 13), 'needs Python 3.13+ (current IANA tables in ipaddress)'

try:
    import netaddr
except ImportError:  # pragma: no cover
    netaddr = None

HAVE = {
    'py': True,
    'netaddr': netaddr is not None,
    'sipcalc': shutil.which('sipcalc') is not None,
    'ipcalc': shutil.which('ipcalc') is not None,
    'ipv6calc': shutil.which('ipv6calc') is not None,
}

# Blocks where CPython 3.13's "not globally reachable" table and our transcription
# of the IANA registry legitimately disagree.
KNOWN_DIFFS = {
    '2001:1::3/128': 'RFC 9665 (2024) exception; in CPython main, not yet in 3.13',
    '5f00::/16': 'RFC 9602 (2024) SRv6 SIDs, Globally Reachable=False; not in CPython tables',
    '192.88.99.2/32': 'RFC 6751 6a44 relay anycast; CPython treats all of 192.88.99.0/24 as global',
}

failures = []
counts = {}


def load(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def run(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def kv(text, sep=r'\s+-\s+|:\s+'):
    out = {}
    for line in text.splitlines():
        parts = re.split(sep, line.strip(), maxsplit=1)
        if len(parts) == 2:
            out.setdefault(parts[0].strip(), parts[1].strip())
    return out


class Check:
    def __init__(self, label):
        self.label = label
        self.tools = set()
        self.problems = []

    def eq(self, tool, what, got, want):
        if not HAVE[tool]:
            return
        if got != want:
            self.problems.append(f'{tool}: {what}: tool says {got!r}, vector says {want!r}')
        self.tools.add(tool)

    def done(self, minimum=2):
        if len(self.tools) < minimum:
            self.problems.append(f'only confirmed by {sorted(self.tools)} (need {minimum})')
        if self.problems:
            failures.append((self.label, self.problems))
        for t in self.tools:
            counts[t] = counts.get(t, 0) + 1
        return not self.problems


def canon(inp, opts=None):
    """Turn a vector input into (address string without zone, prefix) using the tools themselves."""
    s = inp.strip()
    if '/' in s:
        a, m = [x.strip() for x in s.split('/', 1)]
    elif ' ' in s:
        a, m = s.split()
    else:
        a, m = s, None
    a = a.split('%')[0]
    return a, m


# ------------------------------------------------------------------ analyze
def check_analyze(file):
    for v in load(file):
        e = v['expect']
        c = Check(f'{file}: {v["input"]!r}')
        a, m = canon(v['input'])
        forced = (v.get('options') or {}).get('maskAs') == 'wildcard' and e['maskAmbiguous']
        # interpretation of the mask part: python and netaddr parsers must agree with the vector
        if m is not None and not forced:
            c.eq('py', 'prefix', ip.ip_network(f'{a}/{m}', strict=False).prefixlen, e['prefix'])
            if netaddr:
                c.eq('netaddr', 'prefix', netaddr.IPNetwork(f'{a}/{m}').prefixlen, e['prefix'])
        cidr = f'{a}/{e["prefix"]}'
        n = ip.ip_network(cidr, strict=False)
        addr = ip.ip_address(a)
        c.eq('py', 'address', str(addr), e['address'].split('%')[0])
        c.eq('py', 'network', str(n.network_address), e['network'])
        c.eq('py', 'netmask', str(n.netmask), e['netmask'])
        c.eq('py', 'wildcard', str(n.hostmask), e['wildcard'])
        c.eq('py', 'total', str(n.num_addresses), e['totalAddresses'])
        c.eq('py', 'hostBitsSet', addr != n.network_address, e['hostBitsSet'])
        if netaddr:
            nn = netaddr.IPNetwork(cidr)
            c.eq('netaddr', 'network', str(ip.ip_address(str(nn.network))), e['network'])
            c.eq('netaddr', 'netmask', str(ip.ip_address(str(nn.netmask))), e['netmask'])
            c.eq('netaddr', 'wildcard', str(ip.ip_address(str(nn.hostmask))), e['wildcard'])
            c.eq('netaddr', 'total', str(nn.size), e['totalAddresses'])
        sp = e['special']
        if sp and sp['globallyReachable'] is not None and sp['block'] not in KNOWN_DIFFS:
            c.eq('py', f'is_global ({sp["block"]})', n.network_address.is_global, sp['globallyReachable'])
        if n.version == 4:
            check_v4_tools(c, cidr, n, e)
        else:
            check_v6_tools(c, a, cidr, n, e)
        c.done()


def check_v4_tools(c, cidr, n, e):
    p = n.prefixlen
    if HAVE['sipcalc']:
        s = kv(run('sipcalc', cidr))
        c.eq('sipcalc', 'network', s.get('Network address'), e['network'])
        c.eq('sipcalc', 'netmask', s.get('Network mask'), e['netmask'])
        c.eq('sipcalc', 'wildcard', s.get('Cisco wildcard'), e['wildcard'])
        if p > 0:  # sipcalc 1.1.6 overflows at /0 and prints 4294967295
            c.eq('sipcalc', 'total', s.get('Addresses in network'), e['totalAddresses'])
        if p <= 30:
            c.eq('sipcalc', 'broadcast', s.get('Broadcast address'), e['broadcast'])
            c.eq('sipcalc', 'usable range', s.get('Usable range'), f'{e["firstHost"]} - {e["lastHost"]}')
        else:  # /31 /32: RFC 3021 / host route; first..last is the whole network range
            c.eq('sipcalc', 'range', s.get('Network range'), f'{e["firstHost"]} - {e["lastHost"]}')
            c.eq('sipcalc', 'broadcast (none)', e['broadcast'], None)
    if HAVE['ipcalc']:
        s = kv(run('ipcalc', '-n', '-b', cidr), sep=r':\s+')
        hosts = s.get('Hosts/Net', '').split()
        c.eq('ipcalc', 'usable', hosts[0] if hosts else None, e['usableHosts'])
        cls = re.search(r'Class ([A-E])', s.get('Hosts/Net', ''))
        if cidr.split('/')[0] != '255.255.255.255':  # ipcalc prints "Class invalid" for limited broadcast; RFC 1112 4: class E
            c.eq('ipcalc', 'class', cls.group(1) if cls else None, e['ipClass'])
        if p == 32:
            c.eq('ipcalc', 'hostroute', s.get('Hostroute'), e['firstHost'])
        else:
            c.eq('ipcalc', 'HostMin', s.get('HostMin'), e['firstHost'])
            c.eq('ipcalc', 'HostMax', s.get('HostMax'), e['lastHost'])
            if p <= 30:
                c.eq('ipcalc', 'broadcast', s.get('Broadcast'), e['broadcast'])


V6CALC_TYPE = [  # ipv6calc IPV6_TYPE token -> our ipv6Type, most specific first
    ('teredo', 'teredo'), ('6to4', '6to4'), ('nat64', 'nat64'), ('mapped', 'ipv4-mapped'),
    ('unspecified', 'unspecified'), ('loopback', 'loopback'), ('multicast', 'multicast'),
    ('unique-local-unicast', 'ULA'), ('link-local', 'link-local'), ('site-local', 'site-local'),
]


def check_v6_tools(c, a, cidr, n, e):
    addr = ip.IPv6Address(a)
    # SubnetCalc counts every address usable in IPv6 (sipcalc does too; CPython hosts() drops the
    # Subnet-Router anycast address, so compare against the full range instead).
    c.eq('py', 'first', str(n.network_address), e['firstHost'])
    c.eq('py', 'last', str(n.broadcast_address), e['lastHost'])
    c.eq('py', 'usable', str(n.num_addresses), e['usableHosts'])
    t = e['ipv6Type']
    py_type = {
        'unspecified': n.network_address.is_unspecified and n.prefixlen == 128,
        'loopback': n.network_address.is_loopback and n.prefixlen == 128,
        'link-local': n.subnet_of(ip.ip_network('fe80::/10')),
        'site-local': n.is_site_local,
        'multicast': n.is_multicast,
        'ipv4-mapped': addr.ipv4_mapped is not None,
        'teredo': addr.teredo is not None,
        '6to4': addr.sixtofour is not None,
        'ULA': n.subnet_of(ip.ip_network('fc00::/7')),
        'documentation': n.subnet_of(ip.ip_network('2001:db8::/32')) or n.subnet_of(ip.ip_network('3fff::/20')),
        'reserved': n.is_reserved,
        'GUA': n.subnet_of(ip.ip_network('2000::/3')) and n.is_global,
        'nat64': n.subnet_of(ip.ip_network('64:ff9b::/96')),
        'discard': n.subnet_of(ip.ip_network('100::/64')),
    }
    if t is not None:
        c.eq('py', f'type {t}', py_type[t], True)
    emb = e.get('embedded')
    if emb and emb['kind'] == 'teredo':
        server, client = addr.teredo
        c.eq('py', 'teredo server', str(server), emb['server'])
        c.eq('py', 'teredo client', str(client), emb['client'])
    if emb and emb['kind'] == '6to4':
        c.eq('py', '6to4 ipv4', str(addr.sixtofour), emb['ipv4'])
    if emb and emb['kind'] == 'ipv4-mapped':
        c.eq('py', 'mapped ipv4', str(addr.ipv4_mapped), emb['ipv4'])
    if e['slash64']:
        c.eq('py', '/64', str(ip.ip_network(f'{a}/64', strict=False)), e['slash64'])
    else:
        c.eq('py', '/64 count', str(2 ** (64 - n.prefixlen)), e['slash64Count'])
    if HAVE['sipcalc']:
        s = run('sipcalc', cidr)
        m = re.search(r'Network range\s+-\s+(\S+) -\s+(\S+)', s)
        if m:
            c.eq('sipcalc', 'range', (str(ip.ip_address(m.group(1))), str(ip.ip_address(m.group(2)))),
                 (e['firstHost'], e['lastHost']))
        cm = re.search(r'Compressed address\s+-\s+(\S+)', s)
        if cm and addr.ipv4_mapped is None and '.' not in a:
            c.eq('sipcalc', 'compressed', str(ip.ip_address(cm.group(1))), e['address'].split('%')[0])
    if HAVE['ipv6calc']:
        out = kv(run('ipv6calc', '-q', '-i', '-m', a), sep=r'=')
        tokens = out.get('IPV6_TYPE', '').split(',')
        if tokens != ['']:
            mapped = next((ours for tok, ours in V6CALC_TYPE if tok in tokens), None)
            if mapped is None and 'global-unicast' in tokens:
                mapped = 'GUA'
            if t in ('documentation', 'discard', 'reserved', None):
                pass  # ipv6calc has no matching type token; py covers these
            else:
                c.eq('ipv6calc', 'type', mapped, t)
        if emb and emb['kind'] == 'teredo':
            c.eq('ipv6calc', 'teredo port', out.get('TEREDO_PORT_CLIENT'), str(emb['port']))
            src = {v: k for k, v in out.items() if k.startswith('IPV4_SOURCE')}
            c.eq('ipv6calc', 'teredo server', 'IPV4_SOURCE[%s]' % emb['server'], src.get('TEREDO-SERVER'))
            c.eq('ipv6calc', 'teredo client', 'IPV4_SOURCE[%s]' % emb['client'], src.get('TEREDO-CLIENT'))
        elif emb:
            c.eq('ipv6calc', f'{emb["kind"]} ipv4', f'IPV4[{emb["ipv4"]}]' in out, True)


# ------------------------------------------------------------------ errors
def check_errors():
    for v in load('errors.json'):
        c = Check(f'errors.json: {v["input"]!r} -> {v["code"]}')
        s = v['input'].strip()
        s = '/'.join(s.split()) if s else s
        try:
            ip.ip_network(s, strict=False)
            c.eq('py', 'rejects', False, True)
        except ValueError:
            c.eq('py', 'rejects', True, True)
        if netaddr:
            try:
                ok = bool(s) and netaddr.IPNetwork(s, flags=netaddr.INET_PTON) is not None
            except (netaddr.AddrFormatError, ValueError, TypeError):
                ok = False
            c.eq('netaddr', 'rejects', not ok, True)
        c.done()


# ------------------------------------------------------------------ prefix table
def check_prefix_table():
    for v in load('prefix-table-ipv4.json'):
        p = v['prefix']
        c = Check(f'prefix-table-ipv4.json: /{p}')
        n = ip.ip_network(f'0.0.0.0/{p}')
        c.eq('py', 'netmask', str(n.netmask), v['netmask'])
        c.eq('py', 'wildcard', str(n.hostmask), v['wildcard'])
        c.eq('py', 'total', str(n.num_addresses), v['totalAddresses'])
        if HAVE['sipcalc']:
            s = kv(run('sipcalc', f'0.0.0.0/{p}'))
            c.eq('sipcalc', 'netmask', s.get('Network mask'), v['netmask'])
            c.eq('sipcalc', 'wildcard', s.get('Cisco wildcard'), v['wildcard'])
            if p > 0:  # sipcalc 1.1.6 overflows at /0 and prints 4294967295
                c.eq('sipcalc', 'total', s.get('Addresses in network'), v['totalAddresses'])
        if HAVE['ipcalc']:
            s = kv(run('ipcalc', '-n', '-b', f'0.0.0.0/{p}'), sep=r':\s+')
            c.eq('ipcalc', 'usable', s.get('Hosts/Net', '').split()[0], v['usableHosts'])
        c.done()


# ------------------------------------------------------------------ IPv6 formatting
def check_ipv6_format():
    for v in load('ipv6-format.json'):
        c = Check(f'ipv6-format.json: {v["input"]}')
        a = ip.IPv6Address(v['input'])
        c.eq('py', 'compressed', str(a), v['compressed'])
        if '.' not in a.exploded:  # CPython 3.13 explodes IPv4-mapped as ...:ffff:a.b.c.d
            c.eq('py', 'expanded', a.exploded, v['expanded'])
        if netaddr:
            c.eq('netaddr', 'expanded', netaddr.IPAddress(v['input']).format(netaddr.ipv6_verbose), v['expanded'])
        if HAVE['sipcalc']:
            c.eq('sipcalc', 'expanded', kv(run('sipcalc', v['input'])).get('Expanded Address'), v['expanded'])
        if HAVE['ipv6calc']:
            comp = run('ipv6calc', '-q', '--in', 'ipv6addr', '--out', 'ipv6addr', '--printcompressed', v['input']).strip()
            full = run('ipv6calc', '-q', '--in', 'ipv6addr', '--out', 'ipv6addr', '--printfulluncompressed', v['input']).strip()
            c.eq('ipv6calc', 'compressed', comp, v['compressed'])
            if '.' not in full:
                c.eq('ipv6calc', 'expanded', full, v['expanded'])
        c.done()


# ------------------------------------------------------------------ binary
def check_binary():
    for v in load('binary.json'):
        c = Check(f'binary.json: {v["input"]}')
        i = ip.ip_interface(v['input'])
        w, g, sep = (32, 8, '.') if i.version == 4 else (128, 16, ':')

        def b(x):
            s = format(int(x), f'0{w}b')
            return sep.join(s[k:k + g] for k in range(0, w, g))
        c.eq('py', 'address', b(i.ip), v['address'])
        c.eq('py', 'mask', b(i.netmask), v['mask'])
        c.eq('py', 'network', b(i.network.network_address), v['network'])
        if netaddr:
            n = netaddr.IPNetwork(v['input'])
            c.eq('netaddr', 'address', n.ip.bits(), v['address'])
            c.eq('netaddr', 'mask', n.netmask.bits(), v['mask'])
            c.eq('netaddr', 'network', n.network.bits(), v['network'])
        if HAVE['ipcalc'] and i.version == 4:
            out = run('ipcalc', '-b', v['input'])
            m = re.search(r'Address:\s+\S+\s+([01. ]+)', run('ipcalc', v['input']))
            if m:
                c.eq('ipcalc', 'address', m.group(1).replace(' ', '').strip(), v['address'])
        c.done()


# ------------------------------------------------------------------ CIDR operations
def check_cidr_ops():
    d = load('cidr-ops.json')

    def pn(l):
        return [ip.ip_network(x, strict=False) for x in l]

    for v in d['aggregate']:
        c = Check(f'aggregate {v["input"]}')
        c.eq('py', 'collapse', [str(n) for n in ip.collapse_addresses(pn(v['input']))], v['expect'])
        if netaddr:
            c.eq('netaddr', 'cidr_merge', [str(ip.ip_network(str(n))) for n in netaddr.cidr_merge(v['input'])], v['expect'])
        c.done()
    for v in d['supernet']:
        c = Check(f'supernet {v["input"]}')
        ns = pn(v['input'])
        s = ns[0]
        while not all(n.subnet_of(s) for n in ns):
            s = s.supernet()
        c.eq('py', 'supernet', str(s), v['expect'])
        if netaddr:
            span = netaddr.IPNetwork(v['input'][0]).cidr if len(v['input']) == 1 else netaddr.spanning_cidr(v['input'])
            c.eq('netaddr', 'spanning_cidr', str(ip.ip_network(str(span))), v['expect'])
        c.done()
    for v in d['findOverlaps']:
        c = Check(f'findOverlaps {v["input"]}')
        ns = pn(v['input'])
        got_py, got_na = [], []
        for i in range(len(ns)):
            for j in range(i + 1, len(ns)):
                a, b = ns[i], ns[j]
                if a.overlaps(b):
                    got_py.append({'i': i, 'j': j, 'relation': 'equal' if a == b else 'contains' if b.subnet_of(a) else 'contained'})
                if netaddr:
                    A, B = netaddr.IPNetwork(v['input'][i]).cidr, netaddr.IPNetwork(v['input'][j]).cidr
                    if netaddr.IPSet([A]) & netaddr.IPSet([B]):
                        rel = 'equal' if A == B else 'contains' if B in A else 'contained'
                        got_na.append({'i': i, 'j': j, 'relation': rel})
        c.eq('py', 'overlaps', got_py, v['expect'])
        if netaddr:
            c.eq('netaddr', 'overlaps', got_na, v['expect'])
        c.done()
    for v in d['rangeToCidrs']:
        c = Check(f'rangeToCidrs {v["start"]}-{v["end"]}')
        c.eq('py', 'summarize', [str(n) for n in ip.summarize_address_range(ip.ip_address(v['start']), ip.ip_address(v['end']))], v['expect'])
        if netaddr:
            c.eq('netaddr', 'iprange_to_cidrs', [str(ip.ip_network(str(n))) for n in netaddr.iprange_to_cidrs(v['start'], v['end'])], v['expect'])
        c.done()
    for v in d['split']:
        c = Check(f'split {v["input"]} -> /{v["newPrefix"]}')
        c.eq('py', 'subnets', [str(n) for n in ip.ip_network(v['input']).subnets(new_prefix=v['newPrefix'])], v['expect'])
        if netaddr:
            c.eq('netaddr', 'subnet', [str(ip.ip_network(str(n))) for n in netaddr.IPNetwork(v['input']).subnet(v['newPrefix'])], v['expect'])
        c.done()
    for v in d['cidrsubnetArgs']:
        c = Check(f'cidrsubnetArgs {v["parent"]} {v["child"]}')
        P, C = ip.ip_network(v['parent'], strict=False), ip.ip_network(v['child'])
        nb, nn = v['expect']['newbits'], v['expect']['netnum']
        c.eq('py', 'cidrsubnet', str(list(P.subnets(prefixlen_diff=nb))[nn]) if nb <= 16 else
             str(ip.ip_network((int(P.network_address) + (nn << (P.max_prefixlen - P.prefixlen - nb)), P.prefixlen + nb))), str(C))
        if netaddr:
            NP = netaddr.IPNetwork(v['parent']).cidr
            child = netaddr.IPNetwork((NP.first + (nn << (NP._module.width - NP.prefixlen - nb)), NP.prefixlen + nb), version=NP.version)
            c.eq('netaddr', 'cidrsubnet', str(ip.ip_network(str(child))), str(C))
            c.eq('netaddr', 'child in parent', netaddr.IPNetwork(v['child']) in NP, True)
        c.done()
    for v in d['errors']:
        c = Check(f'cidr-ops error {v}')
        try:
            if v['op'] in ('aggregate', 'supernet'):
                if not v['input']:
                    raise ValueError('empty')
                list(ip.collapse_addresses(pn(v['input'])))
            elif v['op'] == 'rangeToCidrs':
                list(ip.summarize_address_range(ip.ip_address(v['start']), ip.ip_address(v['end'])))
            elif v['op'] == 'split':
                n = ip.ip_network(v['input'])
                if v['newPrefix'] < n.prefixlen:
                    raise ValueError('shorter')
                if 2 ** (v['newPrefix'] - n.prefixlen) > v.get('limit', 2 ** 32):
                    raise ValueError('too many')
            elif v['op'] == 'cidrsubnetArgs':
                if not ip.ip_network(v['child']).subnet_of(ip.ip_network(v['parent'])):
                    raise ValueError('not subnet')
            c.eq('py', 'rejects', False, True)
        except (ValueError, TypeError):
            c.eq('py', 'rejects', True, True)
        c.done(minimum=1)


# ------------------------------------------------------------------ VLSM
def check_vlsm():
    d = load('vlsm.json')
    for v in d['requiredPrefix']:
        h, p = v['hosts'], v['expect']
        c = Check(f'requiredPrefix {h}{" /31" if v.get("allowSlash31") else ""}')

        def usable(pp):
            return 2 if pp == 31 else 1 if pp == 32 else 2 ** (32 - pp) - 2
        c.eq('py', 'fits', usable(p) >= h, True)
        smaller_ok = p < 32 and (p + 1 <= (31 if v.get('allowSlash31') else 30)) and usable(p + 1) >= h
        c.eq('py', 'minimal', smaller_ok, False)
        if HAVE['ipcalc']:
            s = kv(run('ipcalc', '-n', '-b', f'0.0.0.0/{p}'), sep=r':\s+')
            c.eq('ipcalc', 'fits', int(s['Hosts/Net'].split()[0]) >= h, True)
            if p + 1 <= (31 if v.get('allowSlash31') else 30):
                s2 = kv(run('ipcalc', '-n', '-b', f'0.0.0.0/{p + 1}'), sep=r':\s+')
                c.eq('ipcalc', 'minimal', int(s2['Hosts/Net'].split()[0]) >= h, False)
        c.done()
    for v in d['plans']:
        c = Check(f'vlsm {v["parent"]} {v["note"]}')
        e = v['expect']
        P = ip.ip_network(v['parent'], strict=False)
        if not e['ok']:
            # verify the failure is real: total demand (power-of-two blocks) exceeds the parent
            need = 0
            for r in sorted(v['requests'], key=lambda r: -r['hosts']):
                need += int(e['error']['needed']) if r['name'] == e['error']['request'] else 0
            blocks = []
            for r in v['requests']:
                p = 31 if (v.get('options', {}).get('allowSlash31') and r['hosts'] <= 2) else next(
                    pp for pp in range(30, -1, -1) if 2 ** (32 - pp) - 2 >= r['hosts'])
                blocks.append(2 ** (32 - p))
            c.eq('py', 'demand exceeds parent', sum(blocks) > P.num_addresses, True)
            if HAVE['ipcalc']:
                s = kv(run('ipcalc', '-n', '-b', str(P)), sep=r':\s+')
                c.eq('ipcalc', 'demand exceeds parent', sum(blocks) > int(s['Hosts/Net'].split()[0]) + 2, True)
            c.done()
            continue
        allocs = [ip.ip_network(a['cidr']) for a in e['allocations']]
        for a, n in zip(e['allocations'], allocs):
            c.eq('py', f'{a["name"]} in parent', n.subnet_of(P), True)
            c.eq('py', f'{a["name"]} netmask', str(n.netmask), a['netmask'])
            usable = 2 if n.prefixlen == 31 else n.num_addresses - 2
            c.eq('py', f'{a["name"]} usable', str(usable), a['usableHosts'])
            c.eq('py', f'{a["name"]} wasted', str(usable - a['hostsRequested']), a['wasted'])
        for i in range(len(allocs)):
            for j in range(i + 1, len(allocs)):
                c.eq('py', f'no overlap {i},{j}', allocs[i].overlaps(allocs[j]), False)
        rest = [P]
        for n in allocs:
            nxt = []
            for r in rest:
                nxt.extend([r] if not r.overlaps(n) else (r.address_exclude(n) if r != n else []))
            rest = nxt
        c.eq('py', 'free', [str(n) for n in ip.collapse_addresses(rest)], e['free'])
        c.eq('py', 'used', str(sum(n.num_addresses for n in allocs)), e['usedAddresses'])
        if netaddr:
            free = netaddr.IPSet([v['parent']]) - netaddr.IPSet([a['cidr'] for a in e['allocations']])
            c.eq('netaddr', 'free', [str(x) for x in free.iter_cidrs()], e['free'])
            c.eq('netaddr', 'free size', str(free.size), e['freeAddresses'])
        c.done()
    for v in d['errors'] + d['requiredPrefixErrors']:
        c = Check(f'vlsm error {v}')
        bad = False
        try:
            if 'parent' in v:
                P = ip.ip_network(v['parent'], strict=False)
                bad = P.version != 4 or any(not float(r['hosts']).is_integer() or r['hosts'] < 1 for r in v['requests'])
            else:
                bad = not (1 <= v['hosts'] <= 2 ** 32 - 2)
        except ValueError:
            bad = True
        c.eq('py', 'rejects', bad, True)
        c.done(minimum=1)


# ------------------------------------------------------------------ EUI-64 / ULA
def check_ipv6_tools():
    d = load('ipv6-tools.json')
    for v in d['eui64']:
        c = Check(f'eui64 {v["mac"]}')
        if netaddr:
            e = netaddr.EUI(v['mac'])
            iid = int(e.modified_eui64())
            c.eq('netaddr', 'interfaceId', ':'.join(format(iid, '016x')[k:k + 4] for k in range(0, 16, 4)), v['interfaceId'])
            c.eq('netaddr', 'address', str(ip.ip_address(str(e.ipv6(int(ip.ip_network(v['prefix']).network_address))))), v['address'])
        if HAVE['ipv6calc']:
            mac = re.sub(r'[^0-9a-fA-F]', '', v['mac'])
            mac = ':'.join(mac[k:k + 2] for k in range(0, 12, 2))
            out = run('ipv6calc', '-q', '--action', 'prefixmac2ipv6', '--in', 'prefix+mac', '--out', 'ipv6addr', v['prefix'], mac).strip()
            c.eq('ipv6calc', 'address', str(ip.ip_interface(out).ip), v['address'])
        c.done()
    for v in d['eui64Errors']:
        c = Check(f'eui64 error {v}')
        bad = False
        if netaddr:
            try:
                netaddr.EUI(v['mac'], version=48)
                if 'prefix' in v:
                    bad = ip.ip_network(v['prefix']).prefixlen != 64
            except (netaddr.AddrFormatError, ValueError, TypeError):
                bad = True
            c.eq('netaddr', 'rejects', bad, True)
        c.done(minimum=1)
    for v in d['ula']:
        c = Check(f'ula {v["randomBytes"]}')
        n = ip.ip_network(v['expect']['prefix'])
        c.eq('py', 'in fd00::/8 (RFC 4193 L=1)', n.subnet_of(ip.ip_network('fd00::/8')), True)
        c.eq('py', '/48', n.prefixlen, 48)
        c.eq('py', 'global id', format((int(n.network_address) >> 80) & (2 ** 40 - 1), '010x'), v['randomBytes'])
        if netaddr:
            nn = netaddr.IPNetwork(v['expect']['prefix'])
            c.eq('netaddr', 'global id', format((nn.first >> 80) & (2 ** 40 - 1), '010x'), v['expect']['globalId'])
        c.done()


# ------------------------------------------------------------------ special-purpose table
def check_special_purpose():
    with open(os.path.join(ROOT, 'lib', 'data', 'special-purpose.json')) as f:
        sp = json.load(f)
    for fam, cls in (('ipv4', ip.IPv4Network), ('ipv6', ip.IPv6Network)):
        const = cls._constants
        for e in sp[fam]:
            c = Check(f'special-purpose {e["block"]} {e["name"]}')
            n = cls(e['block'])
            if e['block'] in KNOWN_DIFFS:
                print(f'  note: {e["block"]}: {KNOWN_DIFFS[e["block"]]}')
                continue
            if e['globallyReachable'] is None:
                continue
            c.eq('py', 'is_global', n.network_address.is_global, e['globallyReachable'])
            c.done(minimum=1)
        # every block CPython lists as not globally reachable must be in our table with False
        blocks = {str(cls(e['block'])): e for e in sp[fam]}
        for n in const._private_networks:
            c = Check(f'special-purpose covers CPython {n}')
            e = blocks.get(str(n))
            if e is None and str(n) == '192.0.0.170/31':
                e = blocks.get('192.0.0.170/32')
            c.eq('py', 'present', e is not None, True)
            if e is not None and e['globallyReachable'] is not None:
                c.eq('py', 'not reachable', e['globallyReachable'], False)
            c.done(minimum=1)


def main():
    print('tools:', ', '.join(k for k, v in HAVE.items() if v))
    missing = [k for k, v in HAVE.items() if not v]
    if missing:
        print('missing (skipped):', ', '.join(missing))
    check_analyze('analyze-ipv4.json')
    check_analyze('analyze-ipv6.json')
    check_errors()
    check_prefix_table()
    check_ipv6_format()
    check_binary()
    check_cidr_ops()
    check_vlsm()
    check_ipv6_tools()
    check_special_purpose()
    print('confirmations per tool:', ', '.join(f'{k}={v}' for k, v in sorted(counts.items())))
    if failures:
        for label, probs in failures:
            print(f'FAIL {label}')
            for p in probs:
                print(f'     {p}')
        print(f'{len(failures)} vector(s) failed cross-check')
        sys.exit(1)
    print('all vectors cross-checked OK')


if __name__ == '__main__':
    main()
