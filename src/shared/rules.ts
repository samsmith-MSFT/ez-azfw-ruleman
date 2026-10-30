import { nameError } from './naming';
import type {
  ChangeItem,
  FirewallRule,
  RuleCollection,
  RuleCollectionGroup,
} from './types';

export const PRIORITY_MIN = 100;
export const PRIORITY_MAX = 65000;

/** Stable JSON with sorted keys; empty arrays/undefined are dropped so equivalent objects compare equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

/** Strips server-managed, read-only fields so only user-editable content remains. */
export function editableGroup(group: RuleCollectionGroup) {
  return { priority: group.priority, ruleCollections: group.ruleCollections };
}

export function groupsEqual(
  a: RuleCollectionGroup,
  b: RuleCollectionGroup,
): boolean {
  return (
    stableStringify(editableGroup(a)) === stableStringify(editableGroup(b))
  );
}

function collectionHeader(c: RuleCollection) {
  return { type: c.ruleCollectionType, priority: c.priority, action: c.action };
}

export function diffGroups(
  baseline: RuleCollectionGroup,
  candidate: RuleCollectionGroup,
): ChangeItem[] {
  const changes: ChangeItem[] = [];
  if (baseline.priority !== candidate.priority) {
    changes.push({
      kind: 'modified',
      target: 'group',
      detail: `priority ${baseline.priority} → ${candidate.priority}`,
    });
  }

  const before = new Map(baseline.ruleCollections.map((c) => [c.name, c]));
  const after = new Map(candidate.ruleCollections.map((c) => [c.name, c]));

  for (const [name, c] of after) {
    const old = before.get(name);
    if (!old) {
      const kind =
        c.ruleCollectionType === 'FirewallPolicyNatRuleCollection'
          ? 'DNAT'
          : c.rules[0]?.ruleType === 'ApplicationRule'
            ? 'Application'
            : 'Network';
      changes.push({
        kind: 'added',
        target: 'collection',
        collection: name,
        detail: `${kind} collection, ${c.action.type}, priority ${c.priority}, ${c.rules.length} ${c.rules.length === 1 ? 'rule' : 'rules'}`,
      });
      // List the new collection's rules too, so the history shows what they do.
      changes.push(...diffRules(name, [], c.rules as FirewallRule[]));
      continue;
    }
    if (
      stableStringify(collectionHeader(old)) !==
      stableStringify(collectionHeader(c))
    ) {
      const parts: string[] = [];
      if (old.priority !== c.priority)
        parts.push(`priority ${old.priority} → ${c.priority}`);
      if (old.action.type !== c.action.type)
        parts.push(`action ${old.action.type} → ${c.action.type}`);
      changes.push({
        kind: 'modified',
        target: 'collection',
        collection: name,
        detail: parts.join(', ') || undefined,
      });
    }
    changes.push(...diffRules(name, old.rules, c.rules));
  }

  for (const name of before.keys()) {
    if (!after.has(name)) {
      const c = before.get(name)!;
      changes.push({
        kind: 'removed',
        target: 'collection',
        collection: name,
        detail: `${c.action.type}, priority ${c.priority}, ${c.rules.length} ${c.rules.length === 1 ? 'rule' : 'rules'}: ${c.rules.map((r) => r.name).join(', ') || 'no rules'}`,
      });
    }
  }
  return changes;
}

function diffRules(
  collection: string,
  before: FirewallRule[],
  after: FirewallRule[],
): ChangeItem[] {
  const changes: ChangeItem[] = [];
  const old = new Map(before.map((r) => [r.name, r]));
  const now = new Map(after.map((r) => [r.name, r]));
  for (const [name, rule] of now) {
    const prev = old.get(name);
    if (!prev) {
      changes.push({
        kind: 'added',
        target: 'rule',
        collection,
        rule: name,
        detail: summarizeRule(rule),
      });
    } else if (stableStringify(prev) !== stableStringify(rule)) {
      changes.push({
        kind: 'modified',
        target: 'rule',
        collection,
        rule: name,
        detail: describeRuleChange(prev, rule),
      });
    }
  }
  for (const name of old.keys()) {
    if (!now.has(name)) {
      changes.push({
        kind: 'removed',
        target: 'rule',
        collection,
        rule: name,
        detail: summarizeRule(old.get(name)!),
      });
    }
  }
  const sameMembers =
    before.length === after.length && before.every((r) => now.has(r.name));
  if (sameMembers && before.some((r, i) => after[i]?.name !== r.name)) {
    changes.push({
      kind: 'modified',
      target: 'collection',
      collection,
      detail: 'rule order changed',
    });
  }
  return changes;
}

/** One-line description of what a rule does: "10.1.0.0/16 → TCP 1433 → 10.0.20.10". */
export function summarizeRule(rule: FirewallRule): string {
  const short = (v: string) => (v.startsWith('/') ? v.split('/').pop()! : v);
  const list = (...lists: (string[] | undefined)[]) =>
    lists
      .flatMap((l) => l ?? [])
      .map(short)
      .join(', ') || '(none)';
  const source = list(rule.sourceAddresses, rule.sourceIpGroups);
  if (rule.ruleType === 'ApplicationRule') {
    const protocols = (rule.protocols ?? [])
      .map((p) => `${p.protocolType}:${p.port}`)
      .join(', ');
    const targets = list(
      rule.targetFqdns,
      rule.fqdnTags?.map((t) => `tag:${t}`),
      rule.webCategories?.map((c) => `category:${c}`),
      rule.targetUrls,
      rule.destinationAddresses,
    );
    return `${source} → ${protocols} → ${targets}`;
  }
  const protocols = (rule.ipProtocols ?? []).join('/');
  if (rule.ruleType === 'NatRule') {
    return `${source} → ${protocols} ${list(rule.destinationAddresses)}:${list(rule.destinationPorts)} → ${rule.translatedAddress ?? rule.translatedFqdn ?? '(none)'}:${rule.translatedPort ?? '(none)'}`;
  }
  return `${source} → ${protocols} ${list(rule.destinationPorts)} → ${list(
    rule.destinationAddresses,
    rule.destinationFqdns,
    rule.destinationIpGroups,
  )}`;
}

const FIELD_LABELS: Record<string, string> = {
  sourceAddresses: 'source',
  sourceIpGroups: 'source IP Groups',
  destinationAddresses: 'destination',
  destinationFqdns: 'destination FQDNs',
  destinationIpGroups: 'destination IP Groups',
  destinationPorts: 'ports',
  ipProtocols: 'protocols',
  protocols: 'protocols',
  targetFqdns: 'target FQDNs',
  targetUrls: 'target URLs',
  fqdnTags: 'FQDN tags',
  webCategories: 'web categories',
  terminateTLS: 'TLS inspection',
  translatedAddress: 'translated address',
  translatedFqdn: 'translated FQDN',
  translatedPort: 'translated port',
  description: 'description',
};

function showValue(v: unknown): string {
  if (v === undefined || v === null || (Array.isArray(v) && !v.length))
    return '(none)';
  if (Array.isArray(v))
    return v
      .map((x) =>
        x && typeof x === 'object' && 'protocolType' in x
          ? `${(x as { protocolType: string }).protocolType}:${(x as { port: number }).port}`
          : String(x),
      )
      .join(', ');
  return String(v);
}

/** "ports 53 → 53, 853; source 10.0.0.0/8 → 10.1.0.0/16" for a modified rule. */
export function describeRuleChange(
  before: FirewallRule,
  after: FirewallRule,
): string | undefined {
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  // Wrap values so empty lists and missing fields normalize to the same thing.
  const same = (k: string) =>
    stableStringify({ v: a[k] }) === stableStringify({ v: b[k] });
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => k !== 'name' && !same(k),
  );
  if (!keys.length) return undefined;
  const parts = keys.map(
    (k) => `${FIELD_LABELS[k] ?? k} ${showValue(a[k])} → ${showValue(b[k])}`,
  );
  return parts.length > 4
    ? `${parts.slice(0, 4).join('; ')}; and ${parts.length - 4} more`
    : parts.join('; ');
}

/**
 * What a draft removed relative to Azure: whole collections, and rules from collections that
 * still exist (with their original position so Undo can put them back).
 */
export function removedItems(
  baseline: RuleCollectionGroup | undefined,
  candidate: RuleCollectionGroup,
): {
  rules: { collection: string; index: number; rule: FirewallRule }[];
  collections: RuleCollection[];
} {
  const rules: { collection: string; index: number; rule: FirewallRule }[] = [];
  const collections: RuleCollection[] = [];
  if (!baseline) return { rules, collections };
  const after = new Map(candidate.ruleCollections.map((c) => [c.name, c]));
  for (const c of baseline.ruleCollections) {
    const now = after.get(c.name);
    if (!now) {
      collections.push(c);
      continue;
    }
    const names = new Set(now.rules.map((r) => r.name));
    (c.rules as FirewallRule[]).forEach((rule, index) => {
      if (!names.has(rule.name))
        rules.push({ collection: c.name, index, rule });
    });
  }
  return { rules, collections };
}

/** Returns the change kind of a rule/collection in the candidate relative to the baseline. */
export function changeKindOf(
  changes: ChangeItem[],
  collection: string,
  rule?: string,
): ChangeItem['kind'] | undefined {
  return changes.find((c) =>
    rule === undefined
      ? c.target === 'collection' &&
        c.collection === collection &&
        c.kind !== 'modified'
      : c.target === 'rule' && c.collection === collection && c.rule === rule,
  )?.kind;
}

// ---------- Validation ----------

const NAME = /^[A-Za-z0-9][\w.-]{0,79}$/;
const PORT = /^(\*|\d{1,5}(-\d{1,5})?)$/;
const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Service tags, optionally regional: "AzureCloud", "Sql.WestUS2", "Internet".
export const SERVICE_TAG = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9-]*)?$/;
// A leading "*." (subdomains) or "*" (anything ending with the rest, e.g. "*contoso.com") is
// allowed; callers that don't support wildcards reject it themselves.
export const FQDN =
  /^(\*\.?)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}\.?$/i;
export const IP_GROUP_ID =
  /^\/subscriptions\/[^/\s]+\/resourceGroups\/[^/\s]+\/providers\/Microsoft\.Network\/ipGroups\/[^/\s]+$/i;

const ipToNumber = (ip: string) =>
  ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);

/** An IPv4 address, CIDR (10.0.0.0/8), range (10.0.0.1-10.0.0.9) or "*". */
export function isAddress(v: string): boolean {
  if (v === '*') return true;
  const cidr = /^([^/]+)\/(\d{1,2})$/.exec(v);
  if (cidr) return IPV4.test(cidr[1]) && Number(cidr[2]) <= 32;
  const range = /^([^-]+)-([^-]+)$/.exec(v);
  if (range)
    return (
      IPV4.test(range[1]) &&
      IPV4.test(range[2]) &&
      ipToNumber(range[1]) <= ipToNumber(range[2])
    );
  return IPV4.test(v);
}

type ItemKind =
  | 'address'
  | 'addressOrTag'
  | 'ip'
  | 'fqdn'
  | 'targetFqdn'
  | 'url'
  | 'ipGroup';

const ITEM_HELP: Record<ItemKind, string> = {
  address:
    'an IPv4 address, CIDR (10.0.0.0/24), range (10.0.0.1-10.0.0.9) or *',
  addressOrTag:
    'an IPv4 address, CIDR, range, service tag (e.g. AzureCloud) or *',
  ip: 'a single IPv4 address',
  fqdn: 'a host name such as db.contoso.com (no wildcards)',
  targetFqdn:
    'a host name such as www.contoso.com, *.contoso.com or *contoso.com',
  url: 'a URL without https://, such as www.contoso.com/path',
  ipGroup: 'an IP Group resource ID (/subscriptions/…/ipGroups/name)',
};

function itemValid(kind: ItemKind, v: string): boolean {
  switch (kind) {
    case 'address':
      return isAddress(v);
    case 'addressOrTag':
      return isAddress(v) || (SERVICE_TAG.test(v) && !IPV4.test(v));
    case 'ip':
      return IPV4.test(v);
    case 'fqdn':
      return !v.startsWith('*') && FQDN.test(v);
    case 'targetFqdn':
      return v === '*' || FQDN.test(v);
    case 'url':
      return !/^[a-z]+:\/\//i.test(v) && /^[^\s/]+\.[^\s/]+(\/\S*)?$/.test(v);
    case 'ipGroup':
      return IP_GROUP_ID.test(v);
  }
}

/** Explains invalid entries in a list field, naming them (and the likely fix). */
function checkItems(
  label: string,
  kind: ItemKind,
  values: string[] | undefined,
  errors: string[],
) {
  const bad = (values ?? []).filter((v) => v.trim() && !itemValid(kind, v));
  if (!bad.length) return;
  const shown = bad
    .slice(0, 3)
    .map((v) => `"${v}"`)
    .join(', ');
  const more = bad.length > 3 ? ` and ${bad.length - 3} more` : '';
  const scheme = bad.some((v) => /^[a-z]+:\/\//i.test(v) || v.includes('/'));
  const hint =
    (kind === 'fqdn' || kind === 'targetFqdn') && scheme
      ? ' Enter just the host name, without https:// or a path.'
      : kind === 'ipGroup' && bad.some((v) => !v.startsWith('/'))
        ? ' Use the full resource ID, not just the IP Group name.'
        : '';
  errors.push(
    `${label}: ${shown}${more} ${bad.length === 1 ? "isn't" : "aren't"} valid. Use ${ITEM_HELP[kind]}.${hint}`,
  );
}

export function isValidPort(p: string): boolean {
  if (!PORT.test(p)) return false;
  if (p === '*') return true;
  const [low, high = low] = p.split('-').map(Number);
  return low >= 0 && high <= 65535 && low <= high;
}

/** Whether a port entry ("443", "8000-8080" or "*") covers the given port. */
export function portCovers(entry: string, port: number): boolean {
  const v = entry.trim();
  if (v === '*') return true;
  const [low, high = low] = v.split('-').map(Number);
  return port >= low && port <= high;
}

function nonEmpty(list?: string[]): boolean {
  return !!list && list.some((v) => v.trim().length > 0);
}

export function validateRule(rule: FirewallRule): string[] {
  const errors: string[] = [];
  if (!rule.name?.trim()) errors.push('Rule name is required.');
  else if (!NAME.test(rule.name)) {
    errors.push(
      `Rule name "${rule.name}" isn't valid: start with a letter or digit and use letters, digits, ".", "-" or "_" (max 80).`,
    );
  }
  const hasSource =
    nonEmpty(rule.sourceAddresses) || nonEmpty(rule.sourceIpGroups);
  if (!hasSource)
    errors.push('At least one source address or IP group is required.');
  checkItems('Source', 'address', rule.sourceAddresses, errors);
  checkItems('Source IP Groups', 'ipGroup', rule.sourceIpGroups, errors);

  switch (rule.ruleType) {
    case 'NetworkRule': {
      checkItems(
        'Destination',
        'addressOrTag',
        rule.destinationAddresses,
        errors,
      );
      checkItems('Destination FQDNs', 'fqdn', rule.destinationFqdns, errors);
      checkItems(
        'Destination IP Groups',
        'ipGroup',
        rule.destinationIpGroups,
        errors,
      );
      if (!nonEmpty(rule.ipProtocols))
        errors.push('Select at least one protocol.');
      if (
        !nonEmpty(rule.destinationAddresses) &&
        !nonEmpty(rule.destinationIpGroups) &&
        !nonEmpty(rule.destinationFqdns)
      ) {
        errors.push(
          'At least one destination address, IP group or FQDN is required.',
        );
      }
      if (!nonEmpty(rule.destinationPorts))
        errors.push('At least one destination port is required.');
      for (const p of rule.destinationPorts ?? []) {
        if (!isValidPort(p))
          errors.push(`Invalid port "${p}". Use 80, 8000-8080 or *.`);
      }
      break;
    }
    case 'ApplicationRule': {
      if (!rule.protocols?.length)
        errors.push('At least one protocol (e.g. Https:443) is required.');
      for (const p of rule.protocols ?? []) {
        if (!p.protocolType || !p.port || p.port < 1 || p.port > 64000) {
          errors.push(
            'Each protocol needs a type (Http/Https/Mssql) and a port between 1 and 64000.',
          );
          break;
        }
      }
      if (
        !nonEmpty(rule.targetFqdns) &&
        !nonEmpty(rule.fqdnTags) &&
        !nonEmpty(rule.targetUrls) &&
        !nonEmpty(rule.webCategories)
      ) {
        errors.push(
          'At least one target FQDN, FQDN tag, URL or web category is required.',
        );
      }
      checkItems('Target FQDNs', 'targetFqdn', rule.targetFqdns, errors);
      checkItems('Target URLs', 'url', rule.targetUrls, errors);
      checkItems(
        'Destination',
        'addressOrTag',
        rule.destinationAddresses,
        errors,
      );
      break;
    }
    case 'NatRule': {
      if (!nonEmpty(rule.ipProtocols))
        errors.push('Select at least one protocol.');
      if (rule.destinationAddresses?.length !== 1) {
        errors.push(
          'DNAT rules need exactly one destination (firewall public IP) address.',
        );
      } else checkItems('Firewall IP', 'ip', rule.destinationAddresses, errors);
      if (rule.translatedAddress?.trim())
        checkItems(
          'Translated address',
          'ip',
          [rule.translatedAddress],
          errors,
        );
      if (rule.translatedFqdn?.trim())
        checkItems('Translated FQDN', 'fqdn', [rule.translatedFqdn], errors);
      if (
        rule.destinationPorts?.length !== 1 ||
        !isValidPort(rule.destinationPorts[0])
      ) {
        errors.push('DNAT rules need exactly one valid destination port.');
      }
      if (!rule.translatedAddress?.trim() && !rule.translatedFqdn?.trim()) {
        errors.push('A translated address or translated FQDN is required.');
      }
      if (
        !rule.translatedPort ||
        !isValidPort(rule.translatedPort) ||
        rule.translatedPort === '*'
      ) {
        errors.push('A valid translated port is required.');
      }
      break;
    }
    default:
      errors.push('Unknown rule type.');
  }
  return errors;
}

function validPriority(p: unknown): boolean {
  return (
    Number.isInteger(p) &&
    (p as number) >= PRIORITY_MIN &&
    (p as number) <= PRIORITY_MAX
  );
}

export function validateCollection(c: RuleCollection): string[] {
  const errors: string[] = [];
  if (!c.name?.trim()) errors.push('Collection name is required.');
  else if (!NAME.test(c.name))
    errors.push(
      `Collection name "${c.name}" isn't valid: start with a letter or digit and use letters, digits, ".", "-" or "_" (max 80).`,
    );
  if (!validPriority(c.priority)) {
    errors.push(
      `Collection "${c.name}": priority must be ${PRIORITY_MIN}-${PRIORITY_MAX}.`,
    );
  }
  if (c.ruleCollectionType === 'FirewallPolicyFilterRuleCollection') {
    if (c.action?.type !== 'Allow' && c.action?.type !== 'Deny') {
      errors.push(`Collection "${c.name}": action must be Allow or Deny.`);
    }
    if ((c.rules as FirewallRule[]).some((r) => r.ruleType === 'NatRule')) {
      errors.push(
        `Collection "${c.name}": DNAT rules are not allowed in a filter collection.`,
      );
    }
    // Azure requires every rule in a collection to be the same type.
    if (new Set(c.rules.map((r) => r.ruleType)).size > 1) {
      errors.push(
        `Collection "${c.name}": network and application rules can't be mixed in one collection.`,
      );
    }
  } else if (c.ruleCollectionType === 'FirewallPolicyNatRuleCollection') {
    if (c.action?.type !== 'DNAT')
      errors.push(`Collection "${c.name}": action must be DNAT.`);
    if (c.rules.some((r) => r.ruleType !== 'NatRule')) {
      errors.push(
        `Collection "${c.name}": a DNAT collection can only contain DNAT rules.`,
      );
    }
  } else {
    errors.push(
      `Collection "${String((c as RuleCollection).name)}": unsupported collection type.`,
    );
  }
  const names = new Set<string>();
  for (const rule of c.rules) {
    const key = rule.name?.toLowerCase();
    if (names.has(key))
      errors.push(
        `Collection "${c.name}": duplicate rule name "${rule.name}".`,
      );
    names.add(key);
    for (const e of validateRule(rule))
      errors.push(`${c.name} / ${rule.name}: ${e}`);
  }
  return errors;
}

/**
 * Problems with a new rule collection group's name and priority, given the policy's other
 * groups (running and drafted). Names are case-insensitive in Azure.
 */
export function newGroupErrors(
  name: string,
  priority: number,
  existing: { name: string; priority: number }[],
): { name?: string; priority?: string } {
  const out: { name?: string; priority?: string } = {};
  out.name = nameError('ruleCollectionGroup', name);
  if (
    !out.name &&
    existing.some((g) => g.name.toLowerCase() === name.toLowerCase())
  )
    out.name = `This policy already has a rule collection group named "${name}".`;
  if (!validPriority(priority))
    out.priority = `Priority must be a whole number from ${PRIORITY_MIN} to ${PRIORITY_MAX}.`;
  else {
    const clash = existing.find((g) => g.priority === priority);
    if (clash)
      out.priority = `Priority ${priority} is already used by "${clash.name}". Each group in a policy needs its own priority.`;
  }
  return out;
}

/**
 * Suggests a free priority: the next hundred above the highest one in use, or, when that's past
 * the limit (e.g. a catch-all at 65000), the lowest free hundred.
 */
export function nextGroupPriority(existing: { priority: number }[]): number {
  const used = new Set(existing.map((g) => g.priority));
  const below = existing.map((g) => g.priority).filter((p) => p < PRIORITY_MAX);
  const next = Math.floor(Math.max(0, ...below) / 100) * 100 + 100;
  if (next <= PRIORITY_MAX && !used.has(next))
    return Math.max(next, PRIORITY_MIN);
  for (let p = PRIORITY_MIN; p <= PRIORITY_MAX; p += 100)
    if (!used.has(p)) return p;
  return PRIORITY_MIN;
}

export function validateGroup(group: RuleCollectionGroup): string[] {
  const errors: string[] = [];
  if (!validPriority(group.priority)) {
    errors.push(
      `Rule collection group priority must be ${PRIORITY_MIN}-${PRIORITY_MAX}.`,
    );
  }
  if (!Array.isArray(group.ruleCollections)) {
    return [...errors, 'ruleCollections must be an array.'];
  }
  const names = new Set<string>();
  for (const c of group.ruleCollections) {
    const key = c.name?.toLowerCase();
    if (names.has(key))
      errors.push(`Duplicate rule collection name "${c.name}".`);
    names.add(key);
    errors.push(...validateCollection(c));
  }
  return errors;
}

/** Splits user input (commas, whitespace or newlines) into a trimmed, de-duplicated list. */
export function parseList(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
