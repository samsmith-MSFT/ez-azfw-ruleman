import { describe, expect, it } from 'vitest';
import { mergeGroup } from './merge';
import type {
  FirewallRule,
  RuleCollection,
  RuleCollectionGroup,
} from './types';

const rule = (name: string, port = '443'): FirewallRule =>
  ({
    name,
    ruleType: 'NetworkRule',
    ipProtocols: ['TCP'],
    sourceAddresses: ['10.0.0.0/8'],
    destinationAddresses: ['10.1.0.4'],
    destinationPorts: [port],
  }) as FirewallRule;

const coll = (
  name: string,
  rules: FirewallRule[],
  priority = 100,
): RuleCollection =>
  ({
    name,
    priority,
    ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
    action: { type: 'Allow' },
    rules,
  }) as RuleCollection;

const group = (
  ruleCollections: RuleCollection[],
  extra: Partial<RuleCollectionGroup> = {},
): RuleCollectionGroup =>
  ({
    id: '/x/ruleCollectionGroups/g',
    name: 'g',
    priority: 200,
    etag: 'e1',
    ruleCollections,
    ...extra,
  }) as RuleCollectionGroup;

describe('mergeGroup', () => {
  it('keeps a drafted rule when Azure only re-saved the group differently', () => {
    const base = group([coll('c', [])], { etag: 'e1' });
    // Azure's copy: new etag, collection without the empty rules list, extra read-only fields.
    const theirs = group(
      [{ ...coll('c', []), rules: undefined } as unknown as RuleCollection],
      { etag: 'e2', provisioningState: 'Succeeded' } as never,
    );
    const mine = group([coll('c', [rule('testrule1')])]);
    const { merged, conflicts } = mergeGroup(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.ruleCollections[0].rules.map((r) => r.name)).toEqual([
      'testrule1',
    ]);
  });

  it('combines edits to different rules and collections', () => {
    const base = group([coll('c', [rule('a'), rule('b')]), coll('d', [])]);
    const theirs = group([
      coll('c', [rule('a', '8443'), rule('b')]),
      coll('d', [rule('x')]),
    ]);
    const mine = group([
      coll('c', [rule('a'), rule('b', '22'), rule('new')]),
      coll('d', []),
      coll('e', [rule('z')], 300),
    ]);
    const { merged, conflicts } = mergeGroup(base, mine, theirs);
    expect(conflicts).toEqual([]);
    const c = merged.ruleCollections.find((x) => x.name === 'c')!;
    expect(
      c.rules.map((r) => [
        r.name,
        (r as { destinationPorts?: string[] }).destinationPorts?.[0],
      ]),
    ).toEqual([
      ['a', '8443'],
      ['b', '22'],
      ['new', '443'],
    ]);
    expect(
      merged.ruleCollections
        .find((x) => x.name === 'd')!
        .rules.map((r) => r.name),
    ).toEqual(['x']);
    expect(merged.ruleCollections.map((x) => x.name)).toContain('e');
  });

  it('honours deletions from either side', () => {
    const base = group([coll('c', [rule('a'), rule('b'), rule('c')])]);
    const theirs = group([coll('c', [rule('a'), rule('c')])]);
    const mine = group([coll('c', [rule('b'), rule('c')])]);
    const { merged, conflicts } = mergeGroup(base, mine, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.ruleCollections[0].rules.map((r) => r.name)).toEqual(['c']);
  });

  it('reports a rule changed differently on both sides', () => {
    const base = group([coll('c', [rule('a')])]);
    const theirs = group([coll('c', [rule('a', '80')])]);
    const mine = group([coll('c', [rule('a', '22')])]);
    expect(mergeGroup(base, mine, theirs).conflicts).toEqual([
      'Rule c / a was changed both here and in Azure',
    ]);
  });

  it('accepts the same change made on both sides', () => {
    const base = group([coll('c', [rule('a')])]);
    const both = group([coll('c', [rule('a', '22')])]);
    expect(mergeGroup(base, both, both).conflicts).toEqual([]);
  });

  it('reports edits to a rule deleted in Azure, and conflicting priorities', () => {
    const base = group([coll('c', [rule('a')])]);
    const theirs = group([coll('c', [])], { priority: 300 });
    const mine = group([coll('c', [rule('a', '22')])], { priority: 400 });
    expect(mergeGroup(base, mine, theirs).conflicts).toEqual([
      'Group priority',
      'Rule c / a was deleted in Azure',
    ]);
  });

  it('keeps a reorder made in the draft', () => {
    const base = group([coll('c', [rule('a'), rule('b')])]);
    const theirs = group([coll('c', [rule('a'), rule('b'), rule('t')])]);
    const mine = group([coll('c', [rule('b'), rule('a')])]);
    const { merged } = mergeGroup(base, mine, theirs);
    expect(merged.ruleCollections[0].rules.map((r) => r.name)).toEqual([
      'b',
      'a',
      't',
    ]);
  });

  it('reports a rule deleted here but changed in Azure, keeping Azure’s copy', () => {
    const base = group([coll('c', [rule('a')])]);
    const theirs = group([coll('c', [rule('a', '80')])]);
    const mine = group([coll('c', [])]);
    const { merged, conflicts } = mergeGroup(base, mine, theirs);
    expect(conflicts).toEqual(['Rule c / a was deleted here']);
    expect(merged.ruleCollections[0].rules.map((r) => r.name)).toEqual(['a']);
  });

  it('reports the same name added differently on both sides', () => {
    const base = group([coll('c', [])]);
    const theirs = group([coll('c', [rule('n', '80')])]);
    const mine = group([coll('c', [rule('n', '22')])]);
    expect(mergeGroup(base, mine, theirs).conflicts).toEqual([
      'Rule c / n was added both here and in Azure',
    ]);
  });

  it('merges collection settings separately from their rules', () => {
    const base = group([coll('c', [rule('a'), rule('b')])]);
    const theirs = group([coll('c', [rule('a', '80'), rule('b')], 300)]);
    const mine = group([coll('c', [rule('a'), rule('b', '22')], 400)]);
    const { merged, conflicts } = mergeGroup(base, mine, theirs);
    expect(conflicts).toEqual(['Collection c settings']);
    expect(merged.ruleCollections[0].priority).toBe(400);

    const priorityOnly = mergeGroup(
      base,
      group([coll('c', [rule('a'), rule('b', '22')])]),
      theirs,
    );
    expect(priorityOnly.conflicts).toEqual([]);
    expect(priorityOnly.merged.ruleCollections[0].priority).toBe(300);
  });

  it('places a drafted rule after the rule that precedes it in the draft', () => {
    const base = group([coll('c', [rule('a'), rule('b')])]);
    const theirs = group([coll('c', [rule('t'), rule('a'), rule('b')])]);
    const mine = group([coll('c', [rule('a'), rule('new'), rule('b')])]);
    expect(
      mergeGroup(base, mine, theirs).merged.ruleCollections[0].rules.map(
        (r) => r.name,
      ),
    ).toEqual(['t', 'a', 'new', 'b']);
  });
});
