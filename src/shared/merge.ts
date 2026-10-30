import { stableStringify } from './rules';
import type {
  FirewallRule,
  RuleCollection,
  RuleCollectionGroup,
} from './types';

export interface MergeResult {
  merged: RuleCollectionGroup;
  /** Items changed both in the draft and in Azure, in different ways. */
  conflicts: string[];
}

const same = (a: unknown, b: unknown) =>
  stableStringify(a) === stableStringify(b);

/**
 * Three-way merge of a drafted group onto Azure's current version, like rebasing a branch:
 * whatever only one side changed is kept, and an item counts as a conflict only when both
 * sides changed it differently. Items are matched by name; equality ignores representation
 * differences (empty lists, missing fields), so Azure re-saving a group isn't a change.
 */
export function mergeGroup(
  base: RuleCollectionGroup,
  mine: RuleCollectionGroup,
  theirs: RuleCollectionGroup,
): MergeResult {
  const conflicts: string[] = [];
  const priority = pick(
    base.priority,
    mine.priority,
    theirs.priority,
    'Group priority',
    conflicts,
  );
  const ruleCollections = mergeNamed(
    base.ruleCollections,
    mine.ruleCollections,
    theirs.ruleCollections,
    (name) => `Collection ${name}`,
    (b, m, t) => mergeCollection(b, m, t, conflicts),
    conflicts,
  );
  return {
    merged: { ...theirs, priority, ruleCollections },
    conflicts,
  };
}

/** Field-level pick: one side's change wins over no change; two different changes conflict. */
function pick<T>(
  base: T,
  mine: T,
  theirs: T,
  label: string,
  conflicts: string[],
): T {
  if (same(mine, base)) return theirs;
  if (same(theirs, base) || same(mine, theirs)) return mine;
  conflicts.push(label);
  return mine;
}

function mergeCollection(
  base: RuleCollection,
  mine: RuleCollection,
  theirs: RuleCollection,
  conflicts: string[],
): RuleCollection {
  const label = `Collection ${mine.name}`;
  const header = (c: RuleCollection) => ({
    type: c.ruleCollectionType,
    priority: c.priority,
    action: c.action,
  });
  const h = pick(
    header(base),
    header(mine),
    header(theirs),
    `${label} settings`,
    conflicts,
  );
  const rules = mergeNamed<FirewallRule>(
    base.rules,
    mine.rules,
    theirs.rules,
    (name) => `Rule ${mine.name} / ${name}`,
    // Two different edits to one rule are a conflict; rules aren't merged field by field.
    undefined,
    conflicts,
  );
  return {
    ...theirs,
    ruleCollectionType: h.type,
    priority: h.priority,
    action: h.action,
    rules,
  } as RuleCollection;
}

/**
 * Merges two lists of named items. The result follows Azure's order, with items added in the
 * draft placed after the item that precedes them in the draft (or first).
 */
function mergeNamed<T extends { name: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
  label: (name: string) => string,
  mergeBoth: ((b: T, m: T, t: T) => T) | undefined,
  conflicts: string[],
): T[] {
  const B = new Map(base.map((x) => [x.name, x]));
  const M = new Map(mine.map((x) => [x.name, x]));
  const T = new Map(theirs.map((x) => [x.name, x]));

  const resolve = (name: string): T | undefined => {
    const b = B.get(name);
    const m = M.get(name);
    const t = T.get(name);
    if (same(m, b)) return t;
    if (same(t, b) || same(m, t)) return m;
    if (b && m && t && mergeBoth) return mergeBoth(b, m, t);
    conflicts.push(
      `${label(name)} was ${!m ? 'deleted here' : !t ? 'deleted in Azure' : !b ? 'added both here and in Azure' : 'changed both here and in Azure'}`,
    );
    return m ?? t;
  };

  const out: T[] = [];
  const placed = new Set<string>();
  for (const t of theirs) {
    const r = resolve(t.name);
    placed.add(t.name);
    if (r) out.push(r);
  }
  // The draft's own order wins when the draft reordered existing items.
  const draftReordered =
    !same(
      mine.filter((x) => B.has(x.name)).map((x) => x.name),
      base.filter((x) => M.has(x.name)).map((x) => x.name),
    ) &&
    same(
      theirs.filter((x) => B.has(x.name)).map((x) => x.name),
      base.filter((x) => T.has(x.name)).map((x) => x.name),
    );
  for (const [i, m] of mine.entries()) {
    if (placed.has(m.name)) continue;
    placed.add(m.name);
    const r = resolve(m.name);
    if (!r) continue;
    const prev = mine
      .slice(0, i)
      .reverse()
      .find((x) => out.some((o) => o.name === x.name));
    const at = prev ? out.findIndex((o) => o.name === prev.name) + 1 : 0;
    out.splice(at, 0, r);
  }
  if (draftReordered) {
    const rank = new Map(mine.map((x, i) => [x.name, i]));
    const kept = out.filter((x) => rank.has(x.name));
    kept.sort((a, b) => rank.get(a.name)! - rank.get(b.name)!);
    let k = 0;
    return out.map((x) => (rank.has(x.name) ? kept[k++] : x));
  }
  return out;
}
