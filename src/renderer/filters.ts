import { useCallback, useEffect, useState } from 'react';
import type { FilterOption } from './components/MultiFilter';
import { readSetting, writeSetting } from './storage';

/** Portal-style list filters: the standard set shown on the Firewalls and Policies pages. */
export type FilterKey =
  | 'name'
  | 'subscription'
  | 'resourceGroup'
  | 'location'
  | 'tag';
export type Filters = Record<FilterKey, string[]>;
export type FilterValues<T> = Record<FilterKey, (item: T) => string[]>;

export const FILTER_LABELS: [FilterKey, string][] = [
  ['name', 'Name'],
  ['subscription', 'Subscription'],
  ['resourceGroup', 'Resource group'],
  ['location', 'Location'],
  ['tag', 'Tag'],
];

const NO_FILTERS: Filters = {
  name: [],
  subscription: [],
  resourceGroup: [],
  location: [],
  tag: [],
};

export const tagPairs = (tags?: Record<string, string>) =>
  Object.entries(tags ?? {}).map(([k, v]) => `${k}: ${v}`);

/** Within a filter any selected value matches; across filters all must match. */
export function matchesFilters<T>(
  item: T,
  filters: Filters,
  values: FilterValues<T>,
  except?: FilterKey,
): boolean {
  return (Object.keys(filters) as FilterKey[]).every((key) => {
    const chosen = filters[key];
    if (key === except || !chosen.length) return true;
    return values[key](item).some((v) => chosen.includes(v));
  });
}

/** Options for one filter with counts, from the items that pass the other filters. */
export function filterOptions<T>(
  key: FilterKey,
  items: T[],
  filters: Filters,
  values: FilterValues<T>,
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!matchesFilters(item, filters, values, key)) continue;
    for (const v of values[key](item)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  // Keep selected values listed even when other filters hide them.
  for (const v of filters[key]) if (!counts.has(v)) counts.set(v, 0);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, n]) => ({ value, hint: String(n) }));
}

/** Saved filters, keeping only known keys with string values; anything else falls back to none. */
export function parseFilters(raw: string | null): Filters {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '{}');
  } catch {
    return NO_FILTERS;
  }
  const saved = (
    typeof data === 'object' && data !== null ? data : {}
  ) as Record<string, unknown>;
  const valuesOf = (key: FilterKey) => {
    const v = saved[key];
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : [];
  };
  return {
    name: valuesOf('name'),
    subscription: valuesOf('subscription'),
    resourceGroup: valuesOf('resourceGroup'),
    location: valuesOf('location'),
    tag: valuesOf('tag'),
  };
}

/** Filter state remembered across sessions under `storageKey`. */
export function useStoredFilters(storageKey: string) {
  const [filters, setFilters] = useState<Filters>(() =>
    parseFilters(readSetting(storageKey)),
  );
  const active = Object.values(filters).some((v) => v.length > 0);
  useEffect(
    () => writeSetting(storageKey, active ? JSON.stringify(filters) : null),
    [storageKey, filters, active],
  );
  const setFilter = useCallback(
    (key: FilterKey, values: string[]) =>
      setFilters((f) => ({ ...f, [key]: values })),
    [],
  );
  const clear = useCallback(() => setFilters(NO_FILTERS), []);
  return { filters, setFilter, clear, active };
}
