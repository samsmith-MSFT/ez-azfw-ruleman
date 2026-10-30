import { describe, it, expect } from 'vitest';
import {
  cidrContains,
  cidrError,
  cidrOverlaps,
  isPublicRange,
  isValidCidr,
  parseCidr,
  suggestSubnet,
} from './cidr';

describe('parseCidr / isValidCidr', () => {
  it('parses a valid network', () => {
    expect(parseCidr('10.0.0.0/16')).toEqual({ start: 167772160, bits: 16 });
  });

  it('rejects malformed values, out-of-range octets and host bits', () => {
    expect(isValidCidr('10.0.0.0')).toBe(false);
    expect(isValidCidr('10.0.0.256/24')).toBe(false);
    expect(isValidCidr('10.0.0.0/33')).toBe(false);
    expect(isValidCidr('10.0.0.5/24')).toBe(false);
  });

  it('handles /0 and /32 boundaries', () => {
    expect(parseCidr('0.0.0.0/0')).toEqual({ start: 0, bits: 0 });
    expect(parseCidr('255.255.255.255/32')).toEqual({
      start: 4294967295,
      bits: 32,
    });
    expect(parseCidr('1.0.0.0/0')).toBeUndefined();
    expect(cidrContains('0.0.0.0/0', '255.255.255.0/24')).toBe(true);
    expect(cidrContains('10.0.0.4/32', '10.0.0.4/32')).toBe(true);
    expect(cidrOverlaps('10.0.0.4/32', '10.0.0.5/32')).toBe(false);
  });
});

describe('cidrContains / cidrOverlaps', () => {
  it('detects containment', () => {
    expect(cidrContains('10.0.0.0/16', '10.0.1.0/26')).toBe(true);
    expect(cidrContains('10.0.0.0/16', '10.1.0.0/26')).toBe(false);
    expect(cidrContains('10.0.0.0/26', '10.0.0.0/24')).toBe(false);
  });

  it('detects overlap', () => {
    expect(cidrOverlaps('10.0.0.0/24', '10.0.0.64/26')).toBe(true);
    expect(cidrOverlaps('10.0.0.0/26', '10.0.0.64/26')).toBe(false);
  });
});

describe('cidrError', () => {
  const err = (v: string) => cidrError(v, 'Space');

  it('accepts a usable private range', () => {
    expect(err('10.0.0.0/16')).toBeUndefined();
    expect(err(' 192.168.0.0/24 ')).toBeUndefined();
  });

  it('explains format problems', () => {
    expect(err('')).toContain('required');
    expect(err('10.0.0.0 /16')).toContain("can't contain spaces");
    expect(err('10.0.0.0')).toContain('needs a prefix length');
    expect(err('10.0.0/16')).toContain("isn't an IPv4 range");
    expect(err('10.0.0.256/24')).toContain('above 255');
    expect(err('10.01.0.0/16')).toContain('leading zeros');
  });

  it('enforces Azure prefix limits', () => {
    expect(err('10.0.0.0/30')).toContain('/2 to /29');
    expect(err('0.0.0.0/1')).toContain('/2 to /29');
  });

  it('suggests the network address when host bits are set', () => {
    expect(err('10.0.1.5/24')).toBe(
      "Space: 10.0.1.5/24 isn't a valid network address for /24 (host bits are set). Did you mean 10.0.1.0/24?",
    );
  });

  it('rejects ranges Azure reserves', () => {
    expect(err('127.0.0.0/8')).toContain('loopback');
    expect(err('169.254.0.0/24')).toContain('link-local');
    expect(err('224.0.0.0/8')).toContain('multicast');
    expect(err('168.63.128.0/22')).toContain('internal DNS');
  });

  it('flags non-RFC 1918 ranges as public', () => {
    expect(isPublicRange('10.0.0.0/16')).toBe(false);
    expect(isPublicRange('172.32.0.0/16')).toBe(true);
  });
});

describe('suggestSubnet', () => {
  it('returns the first free /26', () => {
    expect(suggestSubnet(['10.0.0.0/16'], ['10.0.0.0/24', '10.0.1.0/26'])).toBe(
      '10.0.1.64/26',
    );
  });

  it('skips address spaces that are too small and returns undefined when full', () => {
    expect(suggestSubnet(['10.0.0.0/27'], [])).toBeUndefined();
    expect(suggestSubnet(['10.0.0.0/26'], ['10.0.0.0/26'])).toBeUndefined();
  });
});
