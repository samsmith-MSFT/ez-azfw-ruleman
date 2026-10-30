import { describe, expect, it } from 'vitest';
import { changeWarnings, ruleWarnings } from './risk';
import { isAddress, nextGroupPriority, validateRule } from './rules';
import { addressContains, ruleMatches } from './search';
import type {
  ApplicationRule,
  NatRule,
  NetworkRule,
  RuleCollectionGroup,
} from './types';

const IPG =
  '/subscriptions/6f1c/resourceGroups/rg-net/providers/Microsoft.Network/ipGroups/ipg-spokes';
const net = (over: Partial<NetworkRule> = {}): NetworkRule => ({
  ruleType: 'NetworkRule',
  name: 'r',
  ipProtocols: ['TCP'],
  sourceAddresses: ['10.0.0.0/8'],
  destinationAddresses: ['10.0.10.4'],
  destinationPorts: ['53'],
  ...over,
});
const nat = (over: Partial<NatRule> = {}): NatRule => ({
  ruleType: 'NatRule',
  name: 'rdp-jump',
  ipProtocols: ['TCP'],
  sourceAddresses: ['*'],
  destinationAddresses: ['20.62.18.99'],
  destinationPorts: ['3389'],
  translatedAddress: '10.20.1.5',
  translatedPort: '3389',
  ...over,
});

describe('address validation (per item)', () => {
  it('accepts addresses, CIDRs, ranges, * and service tags where allowed', () => {
    for (const v of ['10.0.0.1', '10.0.0.0/8', '10.0.0.1-10.0.0.9', '*'])
      expect(isAddress(v)).toBe(true);
    expect(
      validateRule(
        net({
          destinationAddresses: ['AzureCloud', 'Sql.WestUS2', '10.1.0.0/16'],
          sourceIpGroups: [IPG],
        }),
      ),
    ).toEqual([]);
  });

  it('rejects malformed IPs, naming the bad entry', () => {
    expect(
      validateRule(net({ destinationAddresses: ['10.0.10.4', '10.0.10.300'] })),
    ).toContain(
      'Destination: "10.0.10.300" isn\'t valid. Use an IPv4 address, CIDR, range, service tag (e.g. AzureCloud) or *.',
    );
    expect(isAddress('10.0.0.9-10.0.0.1')).toBe(false);
    expect(isAddress('10.0.0.0/33')).toBe(false);
    // Service tags are only valid as destinations.
    expect(validateRule(net({ sourceAddresses: ['AzureCloud'] }))[0]).toMatch(
      /^Source: "AzureCloud" isn't valid/,
    );
  });

  it('explains URLs entered as FQDNs and IP Group names instead of IDs', () => {
    const app: ApplicationRule = {
      ruleType: 'ApplicationRule',
      name: 'saas',
      protocols: [{ protocolType: 'Https', port: 443 }],
      sourceIpGroups: ['ipg-spokes'],
      targetFqdns: ['https://contoso.my.salesforce.com/'],
    };
    const errors = validateRule(app);
    expect(errors.some((e) => e.endsWith('without https:// or a path.'))).toBe(
      true,
    );
    expect(
      errors.some((e) =>
        e.endsWith('Use the full resource ID, not just the IP Group name.'),
      ),
    ).toBe(true);
    expect(
      validateRule({
        ...app,
        sourceIpGroups: [IPG],
        targetFqdns: ['*.contoso.com', '*'],
      }),
    ).toEqual([]);
  });

  it('checks DNAT addresses', () => {
    expect(validateRule(nat({ translatedAddress: '10.20.1' }))).toContain(
      'Translated address: "10.20.1" isn\'t valid. Use a single IPv4 address.',
    );
  });
});

describe('risk warnings', () => {
  it('flags any/any allows but not deny rules', () => {
    const anyAny = net({
      sourceAddresses: ['*'],
      destinationAddresses: ['*'],
      destinationPorts: ['*'],
      ipProtocols: ['Any'],
    });
    expect(ruleWarnings(anyAny, 'Allow')[0]).toMatch(
      /any source to any destination on any port/,
    );
    expect(ruleWarnings(anyAny, 'Deny')).toEqual([]);
  });

  it('only calls a rule "any port" when its ports really are all ports', () => {
    const anyAny = (over: Partial<NetworkRule>) =>
      ruleWarnings(
        net({
          sourceAddresses: ['*'],
          destinationAddresses: ['*'],
          ...over,
        }),
        'Allow',
      );
    expect(anyAny({ destinationPorts: ['1-65535'] })[0]).toMatch(/any port/);
    // "Any" protocol on port 53 is broad, but not every port.
    expect(anyAny({ ipProtocols: ['Any'], destinationPorts: ['53'] })).toEqual([
      'Allows any source to any destination.',
    ]);
  });

  it('flags management ports from anywhere, including port ranges', () => {
    expect(
      ruleWarnings(
        net({ sourceAddresses: ['*'], destinationPorts: ['3000-3400'] }),
        'Allow',
      )[0],
    ).toMatch(/RDP \(3389\) from any source/);
    expect(ruleWarnings(net(), 'Allow')).toEqual([]);
  });

  it('flags DNAT published to the internet', () => {
    expect(ruleWarnings(nat(), 'DNAT')[0]).toMatch(
      /^Publishes RDP \(3389\) to the whole internet/,
    );
    expect(
      ruleWarnings(nat({ sourceAddresses: ['203.0.113.0/24'] }), 'DNAT'),
    ).toEqual([]);
  });

  it('reports new risky rules and Allow↔Deny flips at commit, not unchanged rules', () => {
    const group = (
      action: 'Allow' | 'Deny',
      rules: NetworkRule[],
    ): RuleCollectionGroup => ({
      id: 'g',
      name: 'g',
      priority: 100,
      ruleCollections: [
        {
          ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
          name: 'c',
          priority: 100,
          action: { type: action },
          rules,
        },
      ],
    });
    const risky = net({
      name: 'ssh',
      sourceAddresses: ['*'],
      destinationPorts: ['22'],
    });
    // An existing risky rule left alone isn't repeated.
    expect(
      changeWarnings(group('Allow', [risky]), group('Allow', [risky])),
    ).toEqual([]);
    expect(changeWarnings(group('Allow', []), group('Allow', [risky]))).toEqual(
      [
        'c / ssh: Allows SSH (22) from any source. Management ports should be limited to known admin networks.',
      ],
    );
    expect(
      changeWarnings(group('Allow', [net()]), group('Deny', [net()])),
    ).toEqual(['c: action changes Allow → Deny for 1 rule.']);
  });
});

describe('network-aware search', () => {
  it('finds rules whose CIDRs, ranges or * contain an IP', () => {
    expect(addressContains('10.0.0.0/8', '10.1.2.3')).toBe(true);
    expect(addressContains('10.0.0.1-10.0.0.9', '10.0.0.5')).toBe(true);
    expect(addressContains('192.168.0.0/16', '10.1.2.3')).toBe(false);
    expect(ruleMatches(net(), '10.1.2.3')).toBe(true);
    expect(
      ruleMatches(net({ sourceAddresses: ['172.16.0.0/12'] }), '10.1.2.3'),
    ).toBe(false);
  });

  it('finds rules whose port ranges cover a port, and falls back to text', () => {
    expect(ruleMatches(net({ destinationPorts: ['400-500'] }), '445')).toBe(
      true,
    );
    expect(ruleMatches(net({ destinationPorts: ['53'] }), '445')).toBe(false);
    expect(ruleMatches(net({ name: 'dns-to-dc' }), 'DNS')).toBe(true);
  });
});

describe('nextGroupPriority', () => {
  it("doesn't collide with a catch-all at 65000", () => {
    expect(
      nextGroupPriority([
        { priority: 100 },
        { priority: 200 },
        { priority: 65000 },
      ]),
    ).toBe(300);
    expect(nextGroupPriority([{ priority: 65000 }])).toBe(100);
  });
});
