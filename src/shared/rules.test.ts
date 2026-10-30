import { describe, it, expect } from 'vitest';
import {
  changeKindOf,
  diffGroups,
  groupsEqual,
  isValidPort,
  newGroupErrors,
  nextGroupPriority,
  parseList,
  portCovers,
  removedItems,
  summarizeRule,
  validateGroup,
  validateRule,
} from './rules';
import type {
  ApplicationRule,
  FilterRuleCollection,
  FirewallRule,
  NatRule,
  NetworkRule,
  RuleCollectionGroup,
} from './types';

const SUB = '00000000-1111-2222-3333-444444444444';
const RCG = `/subscriptions/${SUB}/resourceGroups/rg-net/providers/Microsoft.Network/firewallPolicies/fp-hub/ruleCollectionGroups/Platform`;

const dns: NetworkRule = {
  ruleType: 'NetworkRule',
  name: 'allow-dns',
  ipProtocols: ['UDP'],
  sourceAddresses: ['10.0.0.0/24'],
  destinationAddresses: ['168.63.129.16'],
  destinationPorts: ['53'],
};

const web: ApplicationRule = {
  ruleType: 'ApplicationRule',
  name: 'allow-ms',
  protocols: [{ protocolType: 'Https', port: 443 }],
  sourceAddresses: ['*'],
  targetFqdns: ['*.microsoft.com'],
};

const dnat: NatRule = {
  ruleType: 'NatRule',
  name: 'https-in',
  ipProtocols: ['TCP'],
  sourceAddresses: ['*'],
  destinationAddresses: ['20.1.2.3'],
  destinationPorts: ['443'],
  translatedAddress: '10.0.1.4',
  translatedPort: '8443',
};

function filter(
  name: string,
  rules: (NetworkRule | ApplicationRule)[],
  action: 'Allow' | 'Deny' = 'Allow',
  priority = 100,
): FilterRuleCollection {
  return {
    ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
    name,
    priority,
    action: { type: action },
    rules,
  };
}

function group(
  collections: RuleCollectionGroup['ruleCollections'],
  priority = 200,
): RuleCollectionGroup {
  return {
    id: RCG,
    name: 'Platform',
    priority,
    etag: 'W/"1"',
    ruleCollections: collections,
  };
}

describe('validateRule', () => {
  it('accepts a valid network rule', () => {
    expect(validateRule(dns)).toEqual([]);
  });

  it('requires destination ports on network rules', () => {
    expect(validateRule({ ...dns, destinationPorts: [] })).not.toEqual([]);
  });

  it('rejects out-of-range ports', () => {
    const errors = validateRule({ ...dns, destinationPorts: ['70000'] });
    expect(errors.some((e) => e.includes('70000'))).toBe(true);
  });

  it('accepts port ranges and wildcards', () => {
    expect(
      validateRule({ ...dns, destinationPorts: ['8000-8080', '*'] }),
    ).toEqual([]);
  });

  it('rejects invalid names', () => {
    expect(validateRule({ ...dns, name: 'bad name!' })).not.toEqual([]);
  });

  it('requires a source', () => {
    expect(
      validateRule({ ...dns, sourceAddresses: [], sourceIpGroups: [] }),
    ).not.toEqual([]);
  });

  it('accepts a valid application rule', () => {
    expect(validateRule(web)).toEqual([]);
  });

  it('requires an application rule target', () => {
    expect(validateRule({ ...web, targetFqdns: [] })).not.toEqual([]);
  });

  it('accepts a valid DNAT rule', () => {
    expect(validateRule(dnat)).toEqual([]);
  });

  it('requires exactly one DNAT destination address', () => {
    expect(
      validateRule({ ...dnat, destinationAddresses: ['20.1.2.3', '20.1.2.4'] }),
    ).not.toEqual([]);
  });

  it('requires a DNAT translated port', () => {
    expect(validateRule({ ...dnat, translatedPort: undefined })).not.toEqual(
      [],
    );
  });
});

describe('validateGroup', () => {
  it('accepts a valid group', () => {
    expect(
      validateGroup(
        group([filter('core', [dns]), filter('web', [web], 'Allow', 200)]),
      ),
    ).toEqual([]);
  });

  it('rejects duplicate collection names (case-insensitive)', () => {
    const errors = validateGroup(
      group([filter('core', [dns]), filter('CORE', [web], 'Allow', 200)]),
    );
    expect(errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('rejects duplicate rule names within a collection', () => {
    const errors = validateGroup(group([filter('core', [dns, { ...dns }])]));
    expect(errors.some((e) => e.includes('duplicate rule name'))).toBe(true);
  });

  it('rejects a group priority below the minimum', () => {
    expect(validateGroup(group([], 50))).not.toEqual([]);
  });

  it('rejects DNAT rules in a filter collection', () => {
    const bad = filter('core', [dnat as unknown as NetworkRule]);
    const errors = validateGroup(group([bad]));
    expect(errors.some((e) => e.includes('DNAT rules are not allowed'))).toBe(
      true,
    );
  });
});

describe('diffGroups', () => {
  const base = group([filter('core', [dns, web])]);

  it('returns no changes for identical groups', () => {
    expect(diffGroups(base, structuredClone(base))).toEqual([]);
  });

  it('detects an added rule', () => {
    const extra: NetworkRule = {
      ...dns,
      name: 'allow-ntp',
      destinationPorts: ['123'],
    };
    const next = group([filter('core', [dns, web, extra])]);
    expect(diffGroups(base, next)).toEqual([
      {
        kind: 'added',
        target: 'rule',
        collection: 'core',
        rule: 'allow-ntp',
        detail: '10.0.0.0/24 → UDP 123 → 168.63.129.16',
      },
    ]);
  });

  it('detects a removed rule', () => {
    const next = group([filter('core', [dns])]);
    expect(diffGroups(base, next)).toEqual([
      {
        kind: 'removed',
        target: 'rule',
        collection: 'core',
        rule: 'allow-ms',
        detail: expect.stringContaining(' → Https:443 → '),
      },
    ]);
  });

  it('detects a modified rule, with a field-level before → after', () => {
    const next = group([
      filter('core', [{ ...dns, destinationPorts: ['53', '853'] }, web]),
    ]);
    expect(diffGroups(base, next)).toEqual([
      {
        kind: 'modified',
        target: 'rule',
        collection: 'core',
        rule: 'allow-dns',
        detail: 'ports 53 → 53, 853',
      },
    ]);
  });

  it('detects added and removed collections', () => {
    const next = group([filter('edge', [dns])]);
    const changes = diffGroups(base, next);
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'added',
        target: 'collection',
        collection: 'edge',
      }),
    );
    expect(changes).toContainEqual({
      kind: 'removed',
      target: 'collection',
      collection: 'core',
      detail: 'Allow, priority 100, 2 rules: allow-dns, allow-ms',
    });
    // A new collection's rules are listed too, with what they do.
    expect(changes).toContainEqual({
      kind: 'added',
      target: 'rule',
      collection: 'edge',
      rule: 'allow-dns',
      detail: '10.0.0.0/24 → UDP 53 → 168.63.129.16',
    });
  });

  it('describes a collection action change', () => {
    const next = group([filter('core', [dns, web], 'Deny')]);
    const [change] = diffGroups(base, next);
    expect(change.kind).toBe('modified');
    expect(change.target).toBe('collection');
    expect(change.detail).toContain('action Allow → Deny');
  });

  it('detects a group priority change', () => {
    const next = { ...structuredClone(base), priority: 300 };
    expect(diffGroups(base, next)).toEqual([
      { kind: 'modified', target: 'group', detail: 'priority 200 → 300' },
    ]);
  });

  it('detects a rule reorder', () => {
    const next = group([filter('core', [web, dns])]);
    expect(diffGroups(base, next)).toEqual([
      {
        kind: 'modified',
        target: 'collection',
        collection: 'core',
        detail: 'rule order changed',
      },
    ]);
  });
});

describe('groupsEqual', () => {
  it('ignores server-managed fields', () => {
    const a = group([filter('core', [dns])]);
    const b = {
      ...structuredClone(a),
      etag: 'W/"2"',
      provisioningState: 'Succeeded',
    };
    expect(groupsEqual(a, b)).toBe(true);
  });

  it('treats omitted optional arrays as empty', () => {
    const withEmpty: FirewallRule = { ...dns, sourceIpGroups: [] };
    expect(
      groupsEqual(
        group([filter('core', [dns])]),
        group([filter('core', [withEmpty as NetworkRule])]),
      ),
    ).toBe(true);
  });

  it('detects real content changes', () => {
    expect(
      groupsEqual(
        group([filter('core', [dns])]),
        group([filter('core', [{ ...dns, destinationPorts: ['5353'] }])]),
      ),
    ).toBe(false);
  });
});

describe('parseList', () => {
  it('splits on commas, whitespace and semicolons and de-duplicates', () => {
    expect(parseList('a, b\nc;;a')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list for blank input', () => {
    expect(parseList('  \n ')).toEqual([]);
  });
});

describe('changeKindOf', () => {
  const changes = diffGroups(
    group([filter('core', [dns])]),
    group([filter('core', [dns, web])]),
  );

  it('returns the kind for a changed rule', () => {
    expect(changeKindOf(changes, 'core', 'allow-ms')).toBe('added');
  });

  it('returns undefined for an untouched rule', () => {
    expect(changeKindOf(changes, 'core', 'allow-dns')).toBeUndefined();
  });
});

describe('newGroupErrors / nextGroupPriority', () => {
  const existing = [
    { name: 'Platform', priority: 100 },
    { name: 'Apps', priority: 250 },
  ];

  it('accepts a unique, well-formed group', () => {
    expect(newGroupErrors('rcg-dns', 300, existing)).toEqual({});
  });

  it('rejects Azure-invalid and duplicate names (case-insensitive)', () => {
    expect(newGroupErrors('my group', 300, existing).name).toMatch(
      /can't contain spaces/,
    );
    expect(newGroupErrors('rcg-', 300, existing).name).toMatch(/must end/);
    expect(newGroupErrors('platform', 300, existing).name).toBe(
      'This policy already has a rule collection group named "platform".',
    );
  });

  it('rejects out-of-range and already-used priorities', () => {
    expect(newGroupErrors('x', 99, existing).priority).toMatch(/100 to 65000/);
    expect(newGroupErrors('x', 100.5, existing).priority).toMatch(/whole/);
    expect(newGroupErrors('x', 250, existing).priority).toBe(
      'Priority 250 is already used by "Apps". Each group in a policy needs its own priority.',
    );
  });

  it('suggests the next free hundred', () => {
    expect(nextGroupPriority([])).toBe(100);
    expect(nextGroupPriority(existing)).toBe(300);
    expect(nextGroupPriority([{ priority: 64990 }])).toBe(65000);
  });
});

describe('removedItems', () => {
  it('lists removed rules with their position, and removed collections', () => {
    const base = group([filter('core', [dns, web]), filter('edge', [dns])]);
    const next = group([filter('core', [web])]);
    expect(removedItems(base, next)).toEqual({
      rules: [{ collection: 'core', index: 0, rule: dns }],
      collections: [base.ruleCollections[1]],
    });
    expect(removedItems(undefined, next)).toEqual({
      rules: [],
      collections: [],
    });
  });
});

describe('ports', () => {
  it('rejects backwards and out-of-range port ranges', () => {
    for (const p of ['80', '8000-8080', '*', '0-65535', '443-443'])
      expect(isValidPort(p)).toBe(true);
    for (const p of ['8080-8000', '65536', '1-70000', '80-', '', ' 80'])
      expect(isValidPort(p)).toBe(false);
    expect(validateRule({ ...dns, destinationPorts: ['600-500'] })).toContain(
      'Invalid port "600-500". Use 80, 8000-8080 or *.',
    );
  });

  it('checks whether an entry covers a port', () => {
    expect(portCovers('*', 1)).toBe(true);
    expect(portCovers(' 443 ', 443)).toBe(true);
    expect(portCovers('400-500', 445)).toBe(true);
    expect(portCovers('400-500', 501)).toBe(false);
    expect(portCovers('abc', 0)).toBe(false);
  });
});

describe('FQDN wildcards', () => {
  const app: ApplicationRule = {
    ruleType: 'ApplicationRule',
    name: 'contoso',
    protocols: [{ protocolType: 'Https', port: 443 }],
    sourceAddresses: ['10.0.0.0/8'],
    targetFqdns: ['*contoso.com', '*.fabrikam.com', 'www.example.com'],
  };

  it('accepts leading wildcards in application target FQDNs', () => {
    expect(validateRule(app)).toEqual([]);
    expect(validateRule({ ...app, targetFqdns: ['www.*.com'] })).toHaveLength(
      1,
    );
  });

  it("rejects wildcards in network-rule FQDNs, which Azure doesn't support", () => {
    const rule: NetworkRule = {
      ...dns,
      destinationAddresses: [],
      destinationFqdns: ['*.contoso.com'],
    };
    expect(validateRule(rule)).toEqual([
      'Destination FQDNs: "*.contoso.com" isn\'t valid. Use a host name such as db.contoso.com (no wildcards).',
    ]);
    expect(
      validateRule({ ...rule, destinationFqdns: ['db.contoso.com'] }),
    ).toEqual([]);
  });
});

describe('summarizeRule', () => {
  it("doesn't print undefined for a DNAT rule without a translation", () => {
    const nat: NatRule = {
      ruleType: 'NatRule',
      name: 'web',
      ipProtocols: ['TCP'],
      sourceAddresses: ['*'],
      destinationAddresses: ['20.62.18.40'],
      destinationPorts: ['443'],
    };
    expect(summarizeRule(nat)).toBe('* → TCP 20.62.18.40:443 → (none):(none)');
  });
});
