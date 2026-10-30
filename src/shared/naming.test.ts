import { describe, it, expect } from 'vitest';
import { nameError, tagError } from './naming';

describe('nameError', () => {
  it('accepts valid names', () => {
    expect(nameError('firewall', 'fw-hub_01.eus')).toBeUndefined();
    expect(nameError('vnet', 'vn')).toBeUndefined();
    expect(nameError('policy', 'a'.repeat(80))).toBeUndefined();
    expect(nameError('resourceGroup', 'rg-(prod)_ü')).toBeUndefined();
  });

  it('names the offending characters', () => {
    expect(nameError('firewall', 'fw hub')).toBe(
      "Firewall name can't contain spaces. Use letters, digits, underscores (_), periods (.) and hyphens (-).",
    );
    expect(nameError('vnet', 'vnet#1!')).toContain('"#", "!"');
    expect(nameError('policy', 'pol(1)')).toContain('"(", ")"');
  });

  it('enforces start and end characters', () => {
    expect(nameError('firewall', '-fw')).toBe(
      'Firewall name must start with a letter or digit.',
    );
    expect(nameError('firewall', '_fw')).toContain('must start');
    expect(nameError('vnet', 'vnet-')).toBe(
      'VNet name must end with a letter, digit or underscore.',
    );
    expect(nameError('vnet', 'vnet.')).toContain('must end');
    expect(nameError('vnet', 'vnet_')).toBeUndefined();
    expect(nameError('resourceGroup', 'rg.')).toBe(
      "Resource group name can't end with a period.",
    );
    expect(nameError('resourceGroup', 'rg-')).toBeUndefined();
  });

  it('enforces lengths', () => {
    expect(nameError('vnet', 'v')).toBe(
      "VNet name must be 2-64 characters (it's 1).",
    );
    expect(nameError('policy', 'a'.repeat(81))).toContain('1-80');
    expect(nameError('resourceGroup', 'r'.repeat(91))).toContain('1-90');
    expect(nameError('firewall', '')).toBe('Firewall name is required.');
  });

  it('uses a custom label', () => {
    expect(nameError('resourceGroup', 'a b', 'Policy resource group')).toMatch(
      /^Policy resource group can't contain spaces/,
    );
  });
});

describe('tagError', () => {
  it('accepts valid tags and rejects forbidden characters and lengths', () => {
    expect(tagError('env', 'prod')).toBeUndefined();
    expect(tagError('a/b?', 'x')).toBe('Tag "a/b?" can\'t contain "/", "?".');
    expect(tagError('', 'x')).toBe('Tag name is required.');
    expect(tagError('k', 'v'.repeat(257))).toContain('256');
    expect(tagError('k'.repeat(513), '')).toContain('512');
  });
});
