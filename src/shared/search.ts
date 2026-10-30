// Rule search that understands networks: an IP finds rules whose CIDRs/ranges contain it, and
// a port finds rules whose port ranges cover it. Anything else is a plain text search.
import { isAddress, portCovers } from './rules';
import type { FirewallRule } from './types';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const toNumber = (ip: string) =>
  ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);

/** Whether an address entry (IP, CIDR, range or *) contains the given IPv4 address. */
export function addressContains(entry: string, ip: string): boolean {
  const e = entry.trim();
  if (e === '*') return true;
  if (!IPV4.test(ip) || !isAddress(ip) || !isAddress(e)) return false;
  const n = toNumber(ip);
  if (e.includes('/')) {
    const [base, bits] = e.split('/');
    const size = 2 ** (32 - Number(bits));
    const start = toNumber(base) - (toNumber(base) % size);
    return n >= start && n < start + size;
  }
  if (e.includes('-')) {
    const [a, b] = e.split('-');
    return n >= toNumber(a) && n <= toNumber(b);
  }
  return toNumber(e) === n;
}

const addressesOf = (r: FirewallRule) => [
  ...(r.sourceAddresses ?? []),
  ...((r as { destinationAddresses?: string[] }).destinationAddresses ?? []),
  ...(r.ruleType === 'NatRule' && r.translatedAddress
    ? [r.translatedAddress]
    : []),
];

const portsOf = (r: FirewallRule): string[] =>
  r.ruleType === 'ApplicationRule'
    ? (r.protocols ?? []).map((p) => String(p.port ?? ''))
    : [
        ...(r.destinationPorts ?? []),
        ...(r.ruleType === 'NatRule' && r.translatedPort
          ? [r.translatedPort]
          : []),
      ];

/** Every string/number value in a rule (not its field names), lowercased for text search. */
function searchableText(value: unknown): string {
  if (Array.isArray(value)) return value.map(searchableText).join('\n');
  if (value && typeof value === 'object')
    return Object.values(value).map(searchableText).join('\n');
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).toLowerCase()
    : '';
}

/** Case-insensitive search; IPs and ports also match the networks and ranges that cover them. */
export function ruleMatches(rule: FirewallRule, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (searchableText(rule).includes(q)) return true;
  if (IPV4.test(q) && isAddress(q))
    return addressesOf(rule).some((a) => addressContains(a, q));
  if (/^\d{1,5}$/.test(q))
    return portsOf(rule).some((p) => portCovers(p, Number(q)));
  return false;
}
