// Fixed worked examples shared by the build (pre-rendered plans) and the example pages
// (deep links into the planners). Data only: no DOM, no rendering.
//
// The AWS plan is packed by the VLSM planner under AWS rules: 6 × /24 for two
// availability zones and three tiers, 250 hosts each (251 usable after AWS reserves 5).
export const AWS_EXAMPLE = {
  parent: '10.0.0.0/16',
  requests: [
    { name: 'public-a', hosts: 250 },
    { name: 'app-a', hosts: 250 },
    { name: 'data-a', hosts: 250 },
    { name: 'public-b', hosts: 250 },
    { name: 'app-b', hosts: 250 },
    { name: 'data-b', hosts: 250 },
  ],
  opts: { reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 28, maxPrefix: 16, provider: 'aws' },
  vlsm: '/vlsm/?p=10.0.0.0/16&r=public-a:250,app-a:250,data-a:250,public-b:250,app-b:250,data-b:250&c=aws',
};

// Azure hub VNet: shared services /24, firewall /26, gateway /27, all under Azure
// rules (first four and last reserved, /29 minimum).
export const AZURE_HUB_EXAMPLE = {
  parent: '10.0.0.0/16',
  requests: [
    { name: 'SharedServices', hosts: 200 },
    { name: 'AzureFirewallSubnet', hosts: 59 },
    { name: 'GatewaySubnet', hosts: 27 },
  ],
  opts: { reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 29, provider: 'azure' },
  vlsm: '/vlsm/?p=10.0.0.0/16&r=SharedServices:200,AzureFirewallSubnet:59,GatewaySubnet:27&c=azure',
};

// One spoke VNet template; the second spoke would use 10.2.0.0/16.
export const AZURE_SPOKE_EXAMPLE = {
  parent: '10.1.0.0/16',
  requests: [
    { name: 'app', hosts: 200 },
    { name: 'data', hosts: 100 },
  ],
  opts: { reservedHosts: 5, reserveHead: 4, reserveTail: 1, minPrefix: 29, provider: 'azure' },
  vlsm: '/vlsm/?p=10.1.0.0/16&r=app:200,data:100&c=azure',
};

// IPv6 hierarchy: one /48 into /56 sites and /64 LANs.
export const IPV6_EXAMPLE = {
  parent: '2001:db8:acad::/48',
  site: 56,
  lan: 64,
  plan: '/ipv6-subnet-plan/?p=2001:db8:acad::/48&s=56&l=64',
};

export const EXAMPLES = [
  {
    href: '/examples/aws-three-tier-vpc/',
    title: 'AWS three-tier VPC subnet plan',
    summary: 'A 10.0.0.0/16 VPC across two availability zones with public, application and data subnets, packed under AWS reservations.',
  },
  {
    href: '/examples/azure-hub-spoke/',
    title: 'Azure hub-spoke subnet plan',
    summary: 'A hub VNet with gateway, firewall and shared services, plus a spoke template, sized under Azure reservations.',
  },
  {
    href: '/examples/ipv6-48-56-64/',
    title: 'IPv6 /48 to /56 to /64 plan',
    summary: 'One /48 split into 256 sites of 256 /64 LANs, with the first and last blocks of each site.',
  },
];
