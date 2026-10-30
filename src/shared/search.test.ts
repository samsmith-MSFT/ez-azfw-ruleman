import { describe, expect, it } from 'vitest';
import { addressContains, ruleMatches } from './search';
import type { ApplicationRule, NetworkRule } from './types';

const rule: NetworkRule = {
  ruleType: 'NetworkRule',
  name: 'dns-to-dc',
  description: 'Domain controllers',
  ipProtocols: ['UDP'],
  sourceAddresses: ['10.0.0.0/8'],
  destinationAddresses: ['10.0.10.4'],
  destinationPorts: ['53'],
};

describe('addressContains', () => {
  it('handles /0, /32, ranges and *', () => {
    expect(addressContains('0.0.0.0/0', '255.255.255.255')).toBe(true);
    expect(addressContains('0.0.0.0/0', '0.0.0.0')).toBe(true);
    expect(addressContains('10.0.0.4/32', '10.0.0.4')).toBe(true);
    expect(addressContains('10.0.0.4/32', '10.0.0.5')).toBe(false);
    expect(addressContains('10.0.0.1-10.0.0.9', '10.0.0.9')).toBe(true);
    expect(addressContains('10.0.0.1-10.0.0.9', '10.0.0.10')).toBe(false);
    expect(addressContains(' * ', '10.0.0.1')).toBe(true);
  });

  it("doesn't match an incomplete or invalid IP", () => {
    // "10.1.2" would otherwise be read as the number 655618, inside 0.0.0.0/8.
    expect(addressContains('0.0.0.0/8', '10.1.2')).toBe(false);
    expect(addressContains('0.0.0.0/0', '10.1.2.300')).toBe(false);
    expect(addressContains('10.0.0.0/8', 'db.contoso.com')).toBe(false);
    expect(addressContains('AzureCloud', '10.0.0.1')).toBe(false);
  });
});

describe('ruleMatches', () => {
  it('searches values, not field names', () => {
    expect(ruleMatches(rule, 'domain')).toBe(true);
    expect(ruleMatches(rule, 'udp')).toBe(true);
    // Every rule has these keys; they mustn't make every rule match.
    expect(ruleMatches(rule, 'source')).toBe(false);
    expect(ruleMatches(rule, 'destinationPorts')).toBe(false);
  });

  it('finds application-rule ports and nested protocol values', () => {
    const app: ApplicationRule = {
      ruleType: 'ApplicationRule',
      name: 'web',
      protocols: [{ protocolType: 'Https', port: 8443 }],
      sourceAddresses: ['*'],
      targetFqdns: ['www.contoso.com'],
    };
    expect(ruleMatches(app, 'https')).toBe(true);
    expect(ruleMatches(app, '8443')).toBe(true);
    expect(ruleMatches(app, '443')).toBe(true);
    expect(ruleMatches(app, '80')).toBe(false);
    expect(ruleMatches(app, '10.1.2.3')).toBe(true);
  });

  it('matches everything for an empty query', () => {
    expect(ruleMatches(rule, '  ')).toBe(true);
  });
});
