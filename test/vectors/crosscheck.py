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
files. --record-provenance updates source metadata only, after every check passes.
Tool checks validate the fields listed in source.validators, not our error-code names.
Application policies (/31 opt-in, IPv4-only VLSM and split limits) use tool-derived
address widths/capacities; they are not claimed to be native tool behaviours.

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
import csv
import hashlib
from datetime import datetime, timezone
from pathlib import Path

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
VERSIONS = {'py': sys.version.split()[0], 'netaddr': netaddr.__version__ if netaddr else None}
for tool, flag in [('ipcalc', '-v'), ('ipv6calc', '-v'), ('sipcalc', '-v')]:
    if HAVE[tool]:
        result = subprocess.run([tool, flag], capture_output=True, text=True)
        VERSIONS[tool] = (result.stdout or result.stderr).strip().splitlines()[0]

# Blocks where CPython 3.13's "not globally reachable" table and our transcription
# of the IANA registry legitimately disagree.
KNOWN_DIFFS = {
    '2001:1::3/128': 'RFC 9665 (2024) exception; in CPython main, not yet in 3.13',
    '5f00::/16': 'RFC 9602 (2024) SRv6 SIDs, Globally Reachable=False; not in CPython tables',
    '192.88.99.2/32': 'RFC 6751 6a44 relay anycast; CPython treats all of 192.88.99.0/24 as global',
    '100:0:0:1::/64': 'RFC 9780 (2025) Dummy IPv6 Prefix; absent from CPython 3.13 tables',
}

failures = []
counts = {}
loaded = {}
REFERENCES = {
    'analyze-ipv4.json': ['https://www.rfc-editor.org/rfc/rfc3021#section-2', 'https://www.iana.org/assignments/iana-ipv4-special-registry/'],
    'analyze-ipv6.json': ['https://www.rfc-editor.org/rfc/rfc4291#section-2', 'https://www.rfc-editor.org/rfc/rfc4380#section-4', 'https://www.iana.org/assignments/iana-ipv6-special-registry/'],
    'ipv6-format.json': ['https://www.rfc-editor.org/rfc/rfc5952#section-4'],
    'ipv6-tools.json': ['https://www.rfc-editor.org/rfc/rfc4291#appendix-A', 'https://www.rfc-editor.org/rfc/rfc4193#section-3.1'],
    'cidr-ops.json': ['https://www.rfc-editor.org/rfc/rfc4632#section-3.1', 'https://developer.hashicorp.com/terraform/language/functions/cidrsubnet'],
    'vlsm.json': ['https://www.rfc-editor.org/rfc/rfc1878', 'https://www.rfc-editor.org/rfc/rfc3021#section-2'],
    'binary.json': ['https://www.rfc-editor.org/rfc/rfc1878'],
    'prefix-table-ipv4.json': ['https://www.rfc-editor.org/rfc/rfc1878', 'https://www.rfc-editor.org/rfc/rfc3021#section-2'],
    'errors.json': ['https://docs.python.org/3/library/ipaddress.html', 'https://netaddr.readthedocs.io/en/latest/api.html'],
}


def load(name):
    if name not in loaded:
        with open(os.path.join(HERE, name)) as f:
            loaded[name] = json.load(f)
    return loaded[name]


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
    def __init__(self, label, vector):
        self.label = label
        self.vector = vector
        self.tools = set()
        self.fields = {}
        self.problems = []

    def eq(self, tool, what, got, want):
        if not HAVE[tool]:
            return
        if got != want:
            self.problems.append(f'{tool}: {what}: tool says {got!r}, vector says {want!r}')
        self.tools.add(tool)
        self.fields.setdefault(tool, []).append(what)

    def done(self):
        if len(self.tools) < 2:
            self.problems.append(f'only confirmed by {sorted(self.tools)} (need 2)')
        if self.problems:
            failures.append((self.label, self.problems))
        for t in self.tools:
            counts[t] = counts.get(t, 0) + 1
        if not self.problems and '--record-provenance' in sys.argv:
            self.vector['source'] = {
                'validators': [{'tool': t, 'version': VERSIONS[t], 'checks': self.fields[t]} for t in sorted(self.tools)],
                'verifiedAt': datetime.now(timezone.utc).date().isoformat(),
            }
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
        c = Check(f'{file}: {v["input"]!r}', v)
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
            c.eq('py', f'is_global ({sp["block"]})', addr.is_global, sp['globallyReachable'])
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
        'unspecified': addr.is_unspecified,
        'loopback': addr.is_loopback,
        'link-local': addr.is_link_local,
        'site-local': addr.is_site_local,
        'multicast': addr.is_multicast,
        'ipv4-mapped': addr.ipv4_mapped is not None,
        'teredo': addr.teredo is not None,
        '6to4': addr.sixtofour is not None,
        'ULA': addr in ip.ip_network('fc00::/7'),
        'documentation': addr in ip.ip_network('2001:db8::/32') or addr in ip.ip_network('3fff::/20'),
        'reserved': addr.is_reserved,
        'GUA': addr in ip.ip_network('2000::/3'),
        'nat64': addr in ip.ip_network('64:ff9b::/96'),
        'discard': addr in ip.ip_network('100::/64'),
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
        c = Check(f'errors.json: {v["input"]!r} -> {v["code"]}', v)
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
        c = Check(f'prefix-table-ipv4.json: /{p}', v)
        n = ip.ip_network(f'0.0.0.0/{p}')
        c.eq('py', 'netmask', str(n.netmask), v['netmask'])
        c.eq('py', 'wildcard', str(n.hostmask), v['wildcard'])
        c.eq('py', 'total', str(n.num_addresses), v['totalAddresses'])
        if netaddr:
            nn = netaddr.IPNetwork(f'0.0.0.0/{p}')
            c.eq('netaddr', 'netmask', str(nn.netmask), v['netmask'])
            c.eq('netaddr', 'wildcard', str(nn.hostmask), v['wildcard'])
            c.eq('netaddr', 'total', str(nn.size), v['totalAddresses'])
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
        c = Check(f'ipv6-format.json: {v["input"]}', v)
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
        c = Check(f'binary.json: {v["input"]}', v)
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
        c = Check(f'aggregate {v["input"]}', v)
        c.eq('py', 'collapse', [str(n) for n in ip.collapse_addresses(pn(v['input']))], v['expect'])
        if netaddr:
            c.eq('netaddr', 'cidr_merge', [str(ip.ip_network(str(n))) for n in netaddr.cidr_merge(v['input'])], v['expect'])
        c.done()
    for v in d['supernet']:
        c = Check(f'supernet {v["input"]}', v)
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
        c = Check(f'findOverlaps {v["input"]}', v)
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
        c = Check(f'rangeToCidrs {v["start"]}-{v["end"]}', v)
        c.eq('py', 'summarize', [str(n) for n in ip.summarize_address_range(ip.ip_address(v['start']), ip.ip_address(v['end']))], v['expect'])
        if netaddr:
            c.eq('netaddr', 'iprange_to_cidrs', [str(ip.ip_network(str(n))) for n in netaddr.iprange_to_cidrs(v['start'], v['end'])], v['expect'])
        c.done()
    for v in d['split']:
        c = Check(f'split {v["input"]} -> /{v["newPrefix"]}', v)
        c.eq('py', 'subnets', [str(n) for n in ip.ip_network(v['input']).subnets(new_prefix=v['newPrefix'])], v['expect'])
        if netaddr:
            c.eq('netaddr', 'subnet', [str(ip.ip_network(str(n))) for n in netaddr.IPNetwork(v['input']).subnet(v['newPrefix'])], v['expect'])
        c.done()
    for v in d['cidrsubnetArgs']:
        c = Check(f'cidrsubnetArgs {v["parent"]} {v["child"]}', v)
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
        c = Check(f'cidr-ops error {v}', v)
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
        if netaddr:
            try:
                if v['op'] in ('aggregate', 'supernet'):
                    ns = [netaddr.IPNetwork(x) for x in v['input']]
                    bad = not ns or len({n.version for n in ns}) != 1
                elif v['op'] == 'rangeToCidrs':
                    start, end = netaddr.IPAddress(v['start']), netaddr.IPAddress(v['end'])
                    bad = start.version != end.version or start > end
                elif v['op'] == 'split':
                    n = netaddr.IPNetwork(v['input'])
                    bad = v['newPrefix'] < n.prefixlen or 2 ** (v['newPrefix'] - n.prefixlen) > v.get('limit', 2 ** 32)
                else:
                    bad = netaddr.IPNetwork(v['child']) not in netaddr.IPNetwork(v['parent'])
            except (ValueError, TypeError, netaddr.AddrFormatError):
                bad = True
            c.eq('netaddr', 'invalid range/family/prefix or application limit', bad, True)
        c.done()


# ------------------------------------------------------------------ VLSM
def check_vlsm():
    d = load('vlsm.json')
    for v in d['requiredPrefix']:
        h, p = v['hosts'], v['expect']
        c = Check(f'requiredPrefix {h}{" /31" if v.get("allowSlash31") else ""}', v)

        def usable(pp):
            return 2 if pp == 31 else 1 if pp == 32 else 2 ** (32 - pp) - 2
        c.eq('py', 'fits', usable(p) >= h, True)
        smaller_ok = p < 32 and (p + 1 <= (31 if v.get('allowSlash31') else 30)) and usable(p + 1) >= h
        c.eq('py', 'minimal', smaller_ok, False)
        if netaddr:
            size = netaddr.IPNetwork(f'0.0.0.0/{p}').size
            capacity = size if p >= 31 else size - 2
            c.eq('netaddr', 'capacity fits hosts (/31 policy)', capacity >= h, True)
            smaller = netaddr.IPNetwork(f'0.0.0.0/{p + 1}').size if p < 32 else 0
            smaller_capacity = smaller if p + 1 >= 31 else smaller - 2
            c.eq('netaddr', 'minimal under /31 policy', p < 32 and p + 1 <= (31 if v.get('allowSlash31') else 30) and smaller_capacity >= h, False)
        if HAVE['ipcalc']:
            s = kv(run('ipcalc', '-n', '-b', f'0.0.0.0/{p}'), sep=r':\s+')
            c.eq('ipcalc', 'fits', int(s['Hosts/Net'].split()[0]) >= h, True)
            if p + 1 <= (31 if v.get('allowSlash31') else 30):
                s2 = kv(run('ipcalc', '-n', '-b', f'0.0.0.0/{p + 1}'), sep=r':\s+')
                c.eq('ipcalc', 'minimal', int(s2['Hosts/Net'].split()[0]) >= h, False)
        c.done()
    for v in d['plans']:
        c = Check(f'vlsm {v["parent"]} {v["note"]}', v)
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
            if netaddr:
                c.eq('netaddr', 'demand exceeds parent', sum(blocks) > netaddr.IPNetwork(v['parent']).size, True)
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
        c = Check(f'vlsm error {v}', v)
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
        if netaddr:
            try:
                if 'parent' in v:
                    P = netaddr.IPNetwork(v['parent'])
                    bad = P.version != 4 or any(not float(r['hosts']).is_integer() or not 1 <= r['hosts'] <= netaddr.IPNetwork('0.0.0.0/0').size - 2 for r in v['requests'])
                else:
                    bad = not (1 <= v['hosts'] <= netaddr.IPNetwork('0.0.0.0/0').size - 2)
            except (ValueError, netaddr.AddrFormatError):
                bad = True
            c.eq('netaddr', 'invalid parent/hosts under IPv4 VLSM policy', bad, True)
        c.done()


# ------------------------------------------------------------------ EUI-64 / ULA
def check_ipv6_tools():
    d = load('ipv6-tools.json')
    for v in d['eui64']:
        c = Check(f'eui64 {v["mac"]}', v)
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
        c = Check(f'eui64 error {v}', v)
        bad = False
        if netaddr:
            try:
                netaddr.EUI(v['mac'], version=48)
                if 'prefix' in v:
                    bad = ip.ip_network(v['prefix']).prefixlen != 64
            except (netaddr.AddrFormatError, ValueError, TypeError):
                bad = True
            c.eq('netaddr', 'rejects', bad, True)
        if 'prefix' in v:
            c.eq('py', 'prefix is not /64 (application policy)', ip.ip_network(v['prefix']).prefixlen != 64, True)
        elif HAVE['ipv6calc']:
            result = subprocess.run(['ipv6calc', '-q', '--action', 'prefixmac2ipv6', '--in', 'prefix+mac', '--out', 'ipv6addr', 'fe80::/64', v['mac']], capture_output=True, text=True)
            c.eq('ipv6calc', 'rejects MAC', result.returncode != 0, True)
        c.done()
    for v in d['ula']:
        c = Check(f'ula {v["randomBytes"]}', v)
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
    for fam in ('ipv4', 'ipv6'):
        raw = Path(ROOT, 'lib/data/sources', f'iana-{fam}.csv').read_bytes()
        assert hashlib.sha256(raw).hexdigest() == sp['_sha256'][fam], f'{fam}: CSV hash mismatch'
        rows = []
        for row in csv.DictReader(raw.decode('utf-8-sig').splitlines()):
            reachable = re.match(r'^(True|False)\b', row['Globally Reachable'])
            for block in row['Address Block'].split(','):
                rows.append({'block': block.split()[0], 'name': row['Name'],
                    'rfc': ', '.join('RFC ' + n for n in re.findall(r'\[RFC(\d+)\]', row['RFC'])),
                    'globallyReachable': reachable.group(1) == 'True' if reachable else None})
        assert rows == sp[fam], f'{fam}: JSON differs from IANA snapshot'
    print('IANA snapshots: all registry fields and SHA-256 hashes match')


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
    for filename, data in loaded.items():
        vectors = data if isinstance(data, list) else [v for group in data.values() for v in group]
        for v in vectors:
            if '--record-provenance' in sys.argv:
                v['source']['references'] = REFERENCES[filename]
            source = v.get('source', {})
            assert len({x['tool'] for x in source.get('validators', [])}) >= 2, f'{filename}: missing provenance'
            assert source.get('references'), f'{filename}: missing references'
        if '--record-provenance' in sys.argv:
            text = json.dumps(data, indent=2)
            # Keep provenance on one line; the input and expected values stay readable.
            text = re.sub(r'(?ms)^([ ]*)"source": (\{\n.*?^\1\})',
                lambda m: m[1] + '"source": ' + json.dumps(json.loads(m[2]), separators=(',', ':')), text)
            Path(HERE, filename).write_text(text + '\n')
    print('all vectors cross-checked OK')


if __name__ == '__main__':
    main()
