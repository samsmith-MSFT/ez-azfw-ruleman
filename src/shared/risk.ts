// Warnings for rules that are valid but risky (overly broad, or exposing management ports).
// Shown while editing and repeated at commit, where they must be acknowledged.
import { portCovers, stableStringify } from './rules';
import type {
  FirewallRule,
  RuleCollection,
  RuleCollectionGroup,
} from './types';

const ANY_ADDRESS = new Set(['*', '0.0.0.0/0', 'internet', 'any']);
const MANAGEMENT_PORTS: { port: number; name: string }[] = [
  { port: 22, name: 'SSH' },
  { port: 23, name: 'Telnet' },
  { port: 445, name: 'SMB' },
  { port: 3389, name: 'RDP' },
  { port: 5985, name: 'WinRM' },
  { port: 5986, name: 'WinRM' },
];

const isAny = (values?: string[]) =>
  (values ?? []).some((v) => ANY_ADDRESS.has(v.trim().toLowerCase()));

/** Source is "anywhere": a wildcard source address (IP Groups alongside it can't narrow it). */
const anySource = (r: FirewallRule) => isAny(r.sourceAddresses);

const ALL_PORTS = new Set(['*', '0-65535', '1-65535']);

const exposedPorts = (ports?: string[]) =>
  MANAGEMENT_PORTS.filter((m) =>
    (ports ?? []).some((p) => portCovers(p, m.port)),
  );

const describePorts = (list: { port: number; name: string }[]) =>
  [...new Set(list.map((m) => `${m.name} (${m.port})`))].join(', ');

export function ruleWarnings(
  rule: FirewallRule,
  action: RuleCollection['action']['type'],
): string[] {
  const warnings: string[] = [];
  if (rule.ruleType === 'NatRule') {
    if (anySource(rule)) {
      const ports = exposedPorts(rule.destinationPorts);
      warnings.push(
        ports.length
          ? `Publishes ${describePorts(ports)} to the whole internet. Restrict the source to known IPs or use Azure Bastion.`
          : 'Publishes this service to any source on the internet. Restrict the source if you can.',
      );
    }
    return warnings;
  }
  if (action !== 'Allow') return warnings;

  if (rule.ruleType === 'NetworkRule') {
    const anyDest =
      isAny(rule.destinationAddresses) && !rule.destinationIpGroups?.length;
    const anyPort = (rule.destinationPorts ?? []).some((p) =>
      ALL_PORTS.has(p.trim()),
    );
    if (anySource(rule) && anyDest && anyPort) {
      warnings.push(
        'Allows any source to any destination on any port: effectively turns the firewall off for this traffic.',
      );
    } else if (anySource(rule)) {
      const ports = exposedPorts(rule.destinationPorts);
      if (ports.length)
        warnings.push(
          `Allows ${describePorts(ports)} from any source. Management ports should be limited to known admin networks.`,
        );
      else if (anyDest) warnings.push('Allows any source to any destination.');
    }
  } else if (rule.ruleType === 'ApplicationRule') {
    if (anySource(rule) && (rule.targetFqdns ?? []).includes('*'))
      warnings.push(
        'Allows any source to reach any web destination (target FQDN *).',
      );
  }
  return warnings;
}

/**
 * Risky changes between a group's running and drafted versions: new or edited rules that trip
 * a warning, and collections whose action flips between Allow and Deny. Unchanged rules aren't
 * repeated, so existing (already-accepted) broad rules don't nag on every commit.
 */
export function changeWarnings(
  baseline: RuleCollectionGroup,
  candidate: RuleCollectionGroup,
): string[] {
  const out: string[] = [];
  const before = new Map(baseline.ruleCollections.map((c) => [c.name, c]));
  for (const c of candidate.ruleCollections) {
    const old = before.get(c.name);
    if (old && old.action.type !== c.action.type && c.rules.length) {
      out.push(
        `${c.name}: action changes ${old.action.type} → ${c.action.type} for ${c.rules.length} ${c.rules.length === 1 ? 'rule' : 'rules'}.`,
      );
    }
    const oldRules = new Map(
      (old?.rules ?? []).map((r) => [r.name, stableStringify(r)]),
    );
    for (const r of c.rules) {
      const unchanged =
        oldRules.get(r.name) === stableStringify(r) &&
        old?.action.type === c.action.type;
      if (unchanged) continue;
      for (const w of ruleWarnings(r, c.action.type))
        out.push(`${c.name} / ${r.name}: ${w}`);
    }
  }
  return out;
}
