// CSV export of rule collection groups: one row per rule, with its group and collection settings,
// so it opens cleanly in Excel for reviews, audits and change tickets.
import type {
  ApplicationRule,
  FirewallRule,
  NatRule,
  NetworkRule,
  RuleCollectionGroup,
} from './types';
import { collectionKindOf } from './ruleDraft';

export interface CsvGroup {
  group: RuleCollectionGroup;
  policyName: string;
  /** Set when the group comes from a parent policy. */
  inheritedFrom?: string;
  /** The group has uncommitted draft changes (the export shows the draft). */
  drafted?: boolean;
}

const COLUMNS = [
  'Policy',
  'Inherited from',
  'Rule collection group',
  'Group priority',
  'Rule collection',
  'Collection priority',
  'Collection type',
  'Action',
  'Rule name',
  'Rule type',
  'Description',
  'Source addresses',
  'Source IP Groups',
  'Protocols',
  'Destination ports',
  'Destination addresses',
  'Destination IP Groups',
  'Destination FQDNs',
  'Target FQDNs',
  'Target URLs',
  'FQDN tags',
  'Web categories',
  'TLS inspection',
  'Translated address',
  'Translated FQDN',
  'Translated port',
  'Uncommitted draft',
] as const;

/** IP Group resource IDs are long; their name is what people recognize. */
const shortId = (v: string) => (v.startsWith('/') ? v.split('/').pop()! : v);
const list = (v?: string[]) => (v ?? []).join('; ');

// Excel and other spreadsheets evaluate cells starting with these (after optional whitespace) as
// formulas. Only a plain number (e.g. "-5") is safe to leave as is.
const FORMULA_START = /^\s*[=+\-@]|^[\t\r\n]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Quotes a cell when needed, and defuses values a spreadsheet would run as a formula
 * (CSV injection), e.g. a description starting with "=".
 */
export function csvCell(value: string | number | boolean | undefined): string {
  let s = value === undefined ? '' : String(value);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ruleCells(r: FirewallRule): Record<string, string> {
  const base = {
    'Rule name': r.name,
    'Rule type':
      r.ruleType === 'NetworkRule'
        ? 'Network'
        : r.ruleType === 'ApplicationRule'
          ? 'Application'
          : 'DNAT',
    Description: r.description ?? '',
    'Source addresses': list(r.sourceAddresses),
    'Source IP Groups': list(r.sourceIpGroups?.map(shortId)),
  };
  if (r.ruleType === 'ApplicationRule') {
    const a = r as ApplicationRule;
    return {
      ...base,
      Protocols: list(a.protocols?.map((p) => `${p.protocolType}:${p.port}`)),
      'Destination addresses': list(a.destinationAddresses),
      'Target FQDNs': list(a.targetFqdns),
      'Target URLs': list(a.targetUrls),
      'FQDN tags': list(a.fqdnTags),
      'Web categories': list(a.webCategories),
      'TLS inspection': a.terminateTLS ? 'Yes' : '',
    };
  }
  if (r.ruleType === 'NatRule') {
    const n = r as NatRule;
    return {
      ...base,
      Protocols: list(n.ipProtocols),
      'Destination ports': list(n.destinationPorts),
      'Destination addresses': list(n.destinationAddresses),
      'Translated address': n.translatedAddress ?? '',
      'Translated FQDN': n.translatedFqdn ?? '',
      'Translated port': n.translatedPort ?? '',
    };
  }
  const n = r as NetworkRule;
  return {
    ...base,
    Protocols: list(n.ipProtocols),
    'Destination ports': list(n.destinationPorts),
    'Destination addresses': list(n.destinationAddresses),
    'Destination IP Groups': list(n.destinationIpGroups?.map(shortId)),
    'Destination FQDNs': list(n.destinationFqdns),
  };
}

/** One row per rule; empty collections and groups still get a row so nothing is missed. */
export function groupsToCsv(groups: CsvGroup[]): string {
  const rows: string[][] = [];
  for (const { group, policyName, inheritedFrom, drafted } of groups) {
    const groupCells = {
      Policy: policyName,
      'Inherited from': inheritedFrom ?? '',
      'Rule collection group': group.name,
      'Group priority': String(group.priority),
      'Uncommitted draft': drafted ? 'Yes' : '',
    };
    const collections = [...group.ruleCollections].sort(
      (a, b) => a.priority - b.priority,
    );
    if (!collections.length)
      rows.push(
        COLUMNS.map((c) => groupCells[c as keyof typeof groupCells] ?? ''),
      );
    for (const c of collections) {
      const colCells = {
        ...groupCells,
        'Rule collection': c.name,
        'Collection priority': String(c.priority),
        'Collection type': collectionKindOf(c),
        Action: c.action.type,
      };
      const rules = c.rules as FirewallRule[];
      if (!rules.length)
        rows.push(
          COLUMNS.map((k) => (colCells as Record<string, string>)[k] ?? ''),
        );
      for (const r of rules) {
        const cells: Record<string, string> = { ...colCells, ...ruleCells(r) };
        rows.push(COLUMNS.map((k) => cells[k] ?? ''));
      }
    }
  }
  // A byte-order mark makes Excel read the file as UTF-8.
  return (
    '\uFEFF' +
    [COLUMNS as readonly string[], ...rows]
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n') +
    '\r\n'
  );
}

/** A safe file name, e.g. "fp-hub-eus_rcg-platform_2026-10-29.csv". */
export function csvFileName(...parts: string[]): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${[...parts, date].join('_').replace(/[^A-Za-z0-9._-]+/g, '-')}.csv`;
}
