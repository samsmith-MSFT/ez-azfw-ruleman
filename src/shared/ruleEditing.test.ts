import { describe, expect, it } from 'vitest';
import { addressEntryError } from './cidr';
import { evaluateFlow } from './flow';
import {
  cellError,
  collectionFromDraft,
  draftFromCollection,
  emptyRow,
  rowFromRule,
  ruleFromRow,
  validateDraft,
} from './ruleDraft';
import type { FilterRuleCollection, NetworkRule } from './types';

const IPG =
  '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/ipGroups/ipg-spokes';

describe('addressEntryError (same wording as the deploy wizard)', () => {
  it('accepts addresses, CIDRs, ranges and *', () => {
    for (const v of [
      '10.0.0.1',
      '10.0.0.0/8',
      '10.0.0.1-10.0.0.9',
      '*',
      '0.0.0.0/0',
    ])
      expect(addressEntryError(v)).toBeUndefined();
  });

  it('explains each kind of mistake', () => {
    expect(addressEntryError('10.0.10.300')).toBe(
      '"10.0.10.300" has an octet above 255',
    );
    expect(addressEntryError('10.01.0.0')).toBe(
      '"10.01.0.0" has leading zeros in an octet',
    );
    expect(addressEntryError('10.0.1.5/24')).toBe(
      "10.0.1.5/24 isn't a valid network address for /24 (host bits are set). Did you mean 10.0.1.0/24?",
    );
    expect(addressEntryError('10.0.0.9-10.0.0.1')).toMatch(/is backwards/);
    expect(addressEntryError('10.0.0.0/33')).toMatch(
      /\/33 isn't a valid prefix length/,
    );
    expect(addressEntryError('AzureCloud')).toBe(
      '"AzureCloud" isn\'t an IPv4 address',
    );
  });
});

describe('IP/CIDR and service tags are separate destination types', () => {
  const rule: NetworkRule = {
    ruleType: 'NetworkRule',
    name: 'kms',
    ipProtocols: ['TCP'],
    sourceAddresses: ['10.0.0.0/8'],
    destinationAddresses: ['AzureCloud', '10.0.20.10', 'Sql.EastUS'],
    destinationPorts: ['1688'],
  };

  it('splits Azure’s single list into IPs and service tags', () => {
    const row = rowFromRule(rule, 'Network');
    expect(row.lists.destinationAddresses).toBe('10.0.20.10');
    expect(row.lists.destinationServiceTags).toBe('AzureCloud, Sql.EastUS');
    expect(row.destField).toBe('destinationAddresses');
  });

  it('merges them back in the original order when unchanged', () => {
    const back = ruleFromRow(
      rowFromRule(rule, 'Network'),
      'Network',
    ) as NetworkRule;
    expect(back.destinationAddresses).toEqual(rule.destinationAddresses);
  });

  it('appends new values after editing', () => {
    const row = rowFromRule(rule, 'Network');
    row.lists.destinationServiceTags += ', Storage';
    expect(
      (ruleFromRow(row, 'Network') as NetworkRule).destinationAddresses,
    ).toEqual(['10.0.20.10', 'AzureCloud', 'Sql.EastUS', 'Storage']);
  });
});

describe('live cell errors', () => {
  const row = () => {
    const r = emptyRow('Network');
    r.name = 'sql-from-spokes';
    return r;
  };

  it('uses the deploy wizard’s naming rules for new or renamed rules', () => {
    const r = { ...row(), name: 'sql from spokes' };
    expect(cellError('name', r, 'Network')).toMatch(
      /^Rule name can't contain spaces/,
    );
    expect(cellError('name', { ...r, name: 'sql-' }, 'Network')).toBe(
      'Rule name must end with a letter, digit or underscore.',
    );
  });

  it('does not judge names that already exist in Azure', () => {
    const existing = rowFromRule(
      {
        ruleType: 'NetworkRule',
        name: 'legacy-',
        sourceAddresses: ['*'],
        destinationAddresses: ['*'],
        destinationPorts: ['*'],
        ipProtocols: ['Any'],
      },
      'Network',
    );
    expect(cellError('name', existing, 'Network')).toBeUndefined();
  });

  it('checks IPs, picked service tags and IP Groups against what Azure has', () => {
    const r = row();
    r.lists.sourceAddresses = '10.1.0.0/16, 10.0.1.5/24';
    expect(cellError('sourceAddresses', r, 'Network')).toMatch(
      /Did you mean 10.0.1.0\/24\?/,
    );
    r.lists.destinationServiceTags = 'AzureCloud, AzureClowd';
    expect(
      cellError('destinationServiceTags', r, 'Network', {
        serviceTags: new Set(['azurecloud']),
      }),
    ).toBe('"AzureClowd" isn\'t a service tag in this region.');
    r.lists.sourceIpGroups = `${IPG}, ipg-missing`;
    expect(
      cellError('sourceIpGroups', r, 'Network', {
        ipGroups: new Set([IPG.toLowerCase()]),
      }),
    ).toMatch(/^"ipg-missing" isn't an IP Group resource ID/);
  });

  it('checks DNAT-specific fields', () => {
    const r = emptyRow('DNAT');
    r.lists.destinationAddresses = '*';
    r.lists.destinationPorts = '443, 8443';
    r.translatedAddress = '10.20.1.0/24';
    expect(cellError('destinationAddresses', r, 'DNAT')).toMatch(
      /use the firewall's public IP/,
    );
    expect(cellError('destinationPorts', r, 'DNAT')).toBe(
      'DNAT rules take exactly one destination port.',
    );
    expect(cellError('translatedAddress', r, 'DNAT')).toBe(
      'Enter a single IP address, not a CIDR or range.',
    );
  });
});

describe('validateDraft with cell errors', () => {
  const collection: FilterRuleCollection = {
    ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
    name: 'legacy-',
    priority: 100,
    action: { type: 'Allow' },
    rules: [
      {
        ruleType: 'NetworkRule',
        name: 'old-rule-',
        ipProtocols: ['TCP'],
        sourceAddresses: ['10.0.0.0/8'],
        destinationAddresses: ['10.0.0.0/8'],
        destinationPorts: ['53'],
      },
    ],
  };

  it('leaves untouched existing rules and names alone', () => {
    expect(validateDraft(draftFromCollection(collection), []).count).toBe(0);
  });

  it('reports format problems per cell and missing values per row for new rules', () => {
    const d = draftFromCollection(collection);
    const r = { ...emptyRow('Network'), name: 'new rule' };
    r.lists.sourceAddresses = '10.0.10.300';
    d.rows.push(r);
    const e = validateDraft(d, []);
    expect(e.cells[r.key]).toEqual({
      name: expect.stringMatching(/can't contain spaces/),
      sourceAddresses: '"10.0.10.300" has an octet above 255.',
    });
    // The row summary keeps only the "missing" problems.
    expect(e.rows[r.key]).toEqual([
      'At least one destination address, IP group or FQDN is required.',
      'At least one destination port is required.',
    ]);
    expect(collectionFromDraft(d).rules).toHaveLength(2);
  });
});

describe('flow tester with IP Group members', () => {
  it('resolves IP Groups when their members are loaded', () => {
    const layers = [
      {
        policyId: 'p',
        policyName: 'fp',
        inherited: false,
        groups: [
          {
            id: 'g',
            name: 'g',
            priority: 100,
            ruleCollections: [
              {
                ruleCollectionType:
                  'FirewallPolicyFilterRuleCollection' as const,
                name: 'c',
                priority: 100,
                action: { type: 'Allow' as const },
                rules: [
                  {
                    ruleType: 'NetworkRule' as const,
                    name: 'dns',
                    ipProtocols: ['UDP' as const],
                    sourceIpGroups: [IPG],
                    destinationAddresses: ['10.0.10.4'],
                    destinationPorts: ['53'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const flow = (source: string) =>
      evaluateFlow(
        { source, destination: '10.0.10.4', protocol: 'UDP', port: 53 },
        layers,
        new Map([[IPG.toLowerCase(), ['10.1.0.0/16']]]),
      );
    expect(flow('10.1.2.3').winner?.rule).toBe('dns');
    expect(flow('10.9.9.9').verdict).toBe('default-deny');
    expect(flow('10.9.9.9').maybes).toEqual([]);
  });
});
