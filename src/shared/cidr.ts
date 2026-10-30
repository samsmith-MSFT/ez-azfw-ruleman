// IPv4 CIDR helpers used to validate and suggest Azure Firewall subnets.

export interface Cidr {
  /** Network address as an unsigned 32-bit integer. */
  start: number;
  bits: number;
}

const CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

export function parseCidr(value: string): Cidr | undefined {
  const m = CIDR.exec(value.trim());
  if (!m) return undefined;
  const octets = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (octets.some((o) => o > 255) || bits > 32) return undefined;
  const ip = octets.reduce((acc, o) => acc * 256 + o, 0);
  const size = 2 ** (32 - bits);
  // Reject host bits being set (e.g. 10.0.0.5/24), as Azure does.
  if (ip % size !== 0) return undefined;
  return { start: ip, bits };
}

export function isValidCidr(value: string): boolean {
  return parseCidr(value) !== undefined;
}

/** Azure's limits for VNet address spaces and subnets. */
export const MIN_PREFIX_BITS = 2;
export const MAX_PREFIX_BITS = 29;

/** Ranges Azure doesn't allow in a VNet (https://learn.microsoft.com/azure/virtual-network/virtual-networks-faq). */
export const RESERVED_RANGES: { cidr: string; name: string }[] = [
  { cidr: '224.0.0.0/4', name: 'multicast' },
  { cidr: '255.255.255.255/32', name: 'broadcast' },
  { cidr: '127.0.0.0/8', name: 'loopback' },
  { cidr: '169.254.0.0/16', name: 'link-local' },
  { cidr: '168.63.129.16/32', name: "Azure's internal DNS" },
];

const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

/**
 * Explains what's wrong with an IPv4 CIDR as used for a VNet address space or subnet, or returns
 * undefined when it's usable.
 */
export function cidrError(value: string, label: string): string | undefined {
  const v = value.trim();
  if (!v) return `${label}: an address range is required (e.g. 10.0.0.0/16).`;
  if (/\s/.test(v)) return `${label}: "${v}" can't contain spaces.`;
  if (!v.includes('/'))
    return `${label}: "${v}" needs a prefix length, e.g. ${v}/24.`;
  const m = CIDR.exec(v);
  if (!m)
    return `${label}: "${v}" isn't an IPv4 range. Use the form 10.0.0.0/16.`;
  const parts = m.slice(1, 5);
  if (parts.some((p) => p.length > 1 && p.startsWith('0')))
    return `${label}: "${v}" has leading zeros in an octet.`;
  const octets = parts.map(Number);
  if (octets.some((o) => o > 255))
    return `${label}: "${v}" has an octet above 255.`;
  const bits = Number(m[5]);
  if (bits < MIN_PREFIX_BITS || bits > MAX_PREFIX_BITS)
    return `${label}: /${bits} isn't allowed. Azure supports /${MIN_PREFIX_BITS} to /${MAX_PREFIX_BITS}.`;
  const ip = octets.reduce((acc, o) => acc * 256 + o, 0);
  const block = 2 ** (32 - bits);
  if (ip % block !== 0) {
    const fixed = formatCidr(ip - (ip % block), bits);
    return `${label}: ${v} isn't a valid network address for /${bits} (host bits are set). Did you mean ${fixed}?`;
  }
  const reserved = RESERVED_RANGES.find((r) => cidrOverlaps(r.cidr, v));
  if (reserved)
    return `${label}: ${v} overlaps the ${reserved.name} range ${reserved.cidr}, which Azure reserves.`;
  return undefined;
}

/** True when the range isn't in RFC 1918 private space (allowed, but usually a mistake). */
export function isPublicRange(value: string): boolean {
  return (
    isValidCidr(value) && !PRIVATE_RANGES.some((p) => cidrContains(p, value))
  );
}

const size = (c: Cidr) => 2 ** (32 - c.bits);

export function cidrContains(outer: string, inner: string): boolean {
  const o = parseCidr(outer);
  const i = parseCidr(inner);
  if (!o || !i) return false;
  return i.start >= o.start && i.start + size(i) <= o.start + size(o);
}

export function cidrOverlaps(a: string, b: string): boolean {
  const x = parseCidr(a);
  const y = parseCidr(b);
  if (!x || !y) return false;
  return x.start < y.start + size(y) && y.start < x.start + size(x);
}

export function formatCidr(start: number, bits: number): string {
  const octets = [24, 16, 8, 0].map(
    (shift) => Math.floor(start / 2 ** shift) % 256,
  );
  return `${octets.join('.')}/${bits}`;
}

/** Finds the first free block of the given size inside the address spaces that avoids used prefixes. */
export function suggestSubnet(
  addressSpaces: string[],
  usedPrefixes: string[],
  bits = 26,
): string | undefined {
  for (const space of addressSpaces) {
    const s = parseCidr(space);
    if (!s || s.bits > bits) continue;
    const step = 2 ** (32 - bits);
    for (
      let start = s.start;
      start + step <= s.start + size(s);
      start += step
    ) {
      const candidate = formatCidr(start, bits);
      if (!usedPrefixes.some((u) => cidrOverlaps(u, candidate)))
        return candidate;
    }
  }
  return undefined;
}

function ipv4Error(ip: string): string | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p)))
    return `"${ip}" isn't an IPv4 address`;
  if (parts.some((p) => p.length > 1 && p.startsWith('0')))
    return `"${ip}" has leading zeros in an octet`;
  if (parts.some((p) => Number(p) > 255))
    return `"${ip}" has an octet above 255`;
  return undefined;
}

const ipNumber = (ip: string) =>
  ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);

/**
 * Explains what's wrong with one firewall-rule address entry: an IPv4 address, CIDR, range
 * (a-b) or "*". Same checks and wording as the deploy wizard's address fields.
 */
export function addressEntryError(value: string): string | undefined {
  const v = value.trim();
  if (v === '*') return undefined;
  if (/\s/.test(v)) return `"${v}" can't contain spaces`;
  if (v.includes('-')) {
    const [a, b, extra] = v.split('-');
    if (extra !== undefined || !a || !b)
      return `"${v}" isn't a valid range. Use 10.0.0.1-10.0.0.20`;
    const bad = ipv4Error(a) ?? ipv4Error(b);
    if (bad) return bad;
    if (ipNumber(a) > ipNumber(b))
      return `"${v}" is backwards: the first address must be the lower one`;
    return undefined;
  }
  if (v.includes('/')) {
    const [ip, bitsText, extra] = v.split('/');
    if (extra !== undefined || !/^\d{1,2}$/.test(bitsText ?? ''))
      return `"${v}" needs a prefix length from 0 to 32, e.g. ${ip}/24`;
    const bad = ipv4Error(ip);
    if (bad) return bad;
    const bits = Number(bitsText);
    if (bits > 32) return `/${bits} isn't a valid prefix length (0-32)`;
    const n = ipNumber(ip);
    const block = 2 ** (32 - bits);
    if (n % block !== 0)
      return `${v} isn't a valid network address for /${bits} (host bits are set). Did you mean ${formatCidr(n - (n % block), bits)}?`;
    return undefined;
  }
  return ipv4Error(v);
}
