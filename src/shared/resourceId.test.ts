import { describe, it, expect } from 'vitest';
import {
  parseResourceId,
  RESOURCE_TYPES,
  isResourceIdOfType,
  resourceName,
  sameResourceId,
} from './resourceId';

const SUB = '00000000-1111-2222-3333-444444444444';
const POLICY = `/subscriptions/${SUB}/resourceGroups/rg-net/providers/Microsoft.Network/firewallPolicies/fp-hub`;
const RCG = `${POLICY}/ruleCollectionGroups/DefaultNetworkRuleCollectionGroup`;
const FW = `/subscriptions/${SUB}/resourceGroups/rg-net/providers/Microsoft.Network/azureFirewalls/fw-hub`;

describe('parseResourceId', () => {
  it('parses a firewall policy ID', () => {
    const parsed = parseResourceId(POLICY);
    expect(parsed.type).toBe(RESOURCE_TYPES.policy);
    expect(parsed.name).toBe('fp-hub');
    expect(parsed.childName).toBeUndefined();
    expect(parsed.subscriptionId).toBe(SUB);
    expect(parsed.resourceGroup).toBe('rg-net');
    expect(parsed.provider).toBe('Microsoft.Network');
  });

  it('parses a rule collection group ID with child name', () => {
    const parsed = parseResourceId(RCG);
    expect(parsed.type).toBe(RESOURCE_TYPES.ruleCollectionGroup);
    expect(parsed.name).toBe('fp-hub');
    expect(parsed.childName).toBe('DefaultNetworkRuleCollectionGroup');
  });

  it('throws on invalid ID format', () => {
    expect(() => parseResourceId('not-an-id')).toThrow();
  });

  it('throws on non‑GUID subscription', () => {
    const bad =
      '/subscriptions/invalid/resourceGroups/rg/providers/Microsoft.Network/firewallPolicies/fp-hub';
    expect(() => parseResourceId(bad)).toThrow();
  });
});

describe('isResourceIdOfType', () => {
  it('detects firewall type (case‑insensitive)', () => {
    expect(isResourceIdOfType(FW, RESOURCE_TYPES.firewall)).toBe(true);
    expect(isResourceIdOfType(FW.toLowerCase(), RESOURCE_TYPES.firewall)).toBe(
      true,
    );
  });

  it('returns false for mismatched type', () => {
    expect(isResourceIdOfType(POLICY, RESOURCE_TYPES.firewall)).toBe(false);
  });

  it('returns false for non‑string input', () => {
    expect(isResourceIdOfType(123, RESOURCE_TYPES.firewall)).toBe(false);
    expect(isResourceIdOfType(undefined, RESOURCE_TYPES.firewall)).toBe(false);
  });
});

describe('resourceName and sameResourceId', () => {
  it('extracts the last segment', () => {
    expect(resourceName(FW)).toBe('fw-hub');
  });

  it('compares IDs case‑insensitively', () => {
    expect(sameResourceId(FW, FW.toLowerCase())).toBe(true);
    expect(sameResourceId(undefined, FW)).toBe(false);
    expect(sameResourceId(undefined, undefined)).toBe(false);
  });
});
