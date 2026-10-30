import { describe, expect, it } from 'vitest';
import {
  collectionFromDraft,
  collectionKindOf,
  draftFromCollection,
  duplicateRow,
  emptyCollection,
  emptyRow,
  isBlankRow,
  ruleFromRow,
  rowFromRule,
  setCollectionKind,
  switchField,
  validateDraft,
} from './ruleDraft';
import { validateCollection } from './rules';
import type {
  ApplicationRule,
  FilterRuleCollection,
  NatRuleCollection,
  NetworkRule,
} from './types';

const IPG =
  '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Network/ipGroups/ipg-spokes';

const net: NetworkRule = {
  ruleType: 'NetworkRule',
  name: 'dns-to-dc',
  description: 'Spokes to DCs',
  ipProtocols: ['UDP', 'TCP'],
  sourceIpGroups: [IPG],
  destinationAddresses: ['10.0.10.4', '10.0.10.5'],
  destinationPorts: ['53'],
};
const app: ApplicationRule = {
  ruleType: 'ApplicationRule',
  name: 'windows-update',
  protocols: [
    { protocolType: 'Https', port: 443 },
    { protocolType: 'Http', port: 80 },
  ],
  sourceAddresses: ['10.0.0.0/8'],
  fqdnTags: ['WindowsUpdate'],
};
const filter = (
  rules: (NetworkRule | ApplicationRule)[],
): FilterRuleCollection => ({
  ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
  name: 'net-allow-core',
  priority: 100,
  action: { type: 'Allow' },
  rules,
});
const dnat: NatRuleCollection = {
  ruleCollectionType: 'FirewallPolicyNatRuleCollection',
  name: 'dnat-web',
  priority: 100,
  action: { type: 'DNAT' },
  rules: [
    {
      ruleType: 'NatRule',
      name: 'web-https',
      ipProtocols: ['TCP'],
      sourceAddresses: ['*'],
      destinationAddresses: ['20.62.18.40'],
      destinationPorts: ['443'],
      translatedAddress: '10.20.1.4',
      translatedPort: '443',
    },
  ],
};

describe('collection kinds', () => {
  it('derives the kind from the collection type and its rules', () => {
    expect(collectionKindOf(filter([net]))).toBe('Network');
    expect(collectionKindOf(filter([app]))).toBe('Application');
    expect(collectionKindOf(filter([]))).toBe('Network');
    expect(collectionKindOf(dnat)).toBe('DNAT');
  });

  it('rejects collections that mix network and application rules (Azure requires one type)', () => {
    expect(validateCollection(filter([net, app]))).toContain(
      'Collection "net-allow-core": network and application rules can\'t be mixed in one collection.',
    );
  });

  it('only lets the kind change while the collection has no real rules', () => {
    const d = emptyCollection(100);
    expect(setCollectionKind(d, 'DNAT').kind).toBe('DNAT');
    const filled = draftFromCollection(filter([net]));
    expect(setCollectionKind(filled, 'Application')).toBe(filled);
  });
});

describe('rows round-trip', () => {
  it('round-trips network, application and DNAT collections unchanged', () => {
    for (const c of [filter([net]), filter([app]), dnat]) {
      expect(collectionFromDraft(draftFromCollection(c))).toEqual(
        expect.objectContaining({
          name: c.name,
          priority: c.priority,
          ruleCollectionType: c.ruleCollectionType,
          action: c.action,
        }),
      );
      const back = collectionFromDraft(draftFromCollection(c)).rules[0];
      // Every field of the original rule survives (empty lists may be added).
      expect(back).toMatchObject(c.rules[0]);
    }
  });

  it('picks the grid cell type from the populated list', () => {
    const row = rowFromRule(net, 'Network');
    expect(row.sourceField).toBe('sourceIpGroups');
    expect(row.destField).toBe('destinationAddresses');
    expect(rowFromRule(app, 'Application').destField).toBe('fqdnTags');
  });

  it('preserves fields the grid does not show', () => {
    const withExtra = { ...net, futureField: 'keep-me' } as NetworkRule;
    expect(
      ruleFromRow(rowFromRule(withExtra, 'Network'), 'Network'),
    ).toMatchObject({
      futureField: 'keep-me',
    });
  });

  it('defaults application ports from the protocol', () => {
    const row = {
      ...emptyRow('Application'),
      name: 'saas',
      appProtocols: 'https, http',
    };
    row.lists.sourceAddresses = '10.0.0.0/8';
    row.lists.targetFqdns = 'app.example.com';
    expect(
      (ruleFromRow(row, 'Application') as ApplicationRule).protocols,
    ).toEqual([
      { protocolType: 'Https', port: 443 },
      { protocolType: 'Http', port: 80 },
    ]);
  });
});

describe('row editing helpers', () => {
  it('moves typed text when the destination type changes', () => {
    const row = emptyRow('Network');
    row.lists.destinationAddresses = 'sql01.contoso.com';
    const switched = switchField(row, 'dest', 'destinationFqdns');
    expect(switched.destField).toBe('destinationFqdns');
    expect(switched.lists.destinationFqdns).toBe('sql01.contoso.com');
    expect(switched.lists.destinationAddresses).toBe('');
  });

  it('treats untouched rows as blank and drops them on save', () => {
    const d = emptyCollection(100);
    d.name = 'empty-ok';
    expect(isBlankRow(d.rows[0])).toBe(true);
    expect(collectionFromDraft(d).rules).toEqual([]);
    expect(validateDraft(d, []).count).toBe(0);
  });

  it('duplicates with a unique name', () => {
    const row = rowFromRule(net, 'Network');
    expect(duplicateRow(row, ['dns-to-dc', 'dns-to-dc-copy']).name).toBe(
      'dns-to-dc-copy2',
    );
  });
});

describe('validateDraft', () => {
  it('maps rule problems to their rows and flags duplicate names', () => {
    const d = draftFromCollection(filter([net]));
    const bad = { ...emptyRow('Network'), name: 'DNS-TO-DC' };
    bad.lists.sourceAddresses = '10.0.0.0/8';
    d.rows.push(bad);
    const errors = validateDraft(d, []);
    expect(errors.rows[d.rows[0].key]).toBeUndefined();
    expect(errors.rows[bad.key]).toEqual(
      expect.arrayContaining([
        'Another rule in this collection is named "DNS-TO-DC".',
        'At least one destination port is required.',
      ]),
    );
  });

  it('checks the name and priority against the other collections in the group', () => {
    const d = draftFromCollection(filter([net]));
    const errors = validateDraft(d, [
      { name: 'NET-ALLOW-CORE', priority: 300 },
      { name: 'app-allow', priority: 100 },
    ]).collection;
    expect(errors).toContain(
      'A collection named "net-allow-core" already exists in this group.',
    );
    expect(errors).toContain(
      'Priority 100 is already used by "app-allow" in this group. Give each collection its own priority so the processing order is unambiguous.',
    );
  });
});
