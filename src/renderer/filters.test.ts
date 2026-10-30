import { describe, it, expect } from 'vitest';
import {
  filterOptions,
  matchesFilters,
  parseFilters,
  tagPairs,
  type FilterValues,
  type Filters,
} from './filters';

interface Item {
  name: string;
  rg: string;
  location: string;
  tags?: Record<string, string>;
}

const VALUES: FilterValues<Item> = {
  name: (i) => [i.name],
  subscription: () => ['sub-1'],
  resourceGroup: (i) => [i.rg],
  location: (i) => [i.location],
  tag: (i) => tagPairs(i.tags),
};

const ITEMS: Item[] = [
  { name: 'fw-a', rg: 'rg-hub', location: 'eastus', tags: { env: 'prod' } },
  { name: 'fw-b', rg: 'rg-hub', location: 'westus', tags: { env: 'dev' } },
  { name: 'fw-c', rg: 'rg-spoke', location: 'eastus' },
];

const none = (): Filters => ({
  name: [],
  subscription: [],
  resourceGroup: [],
  location: [],
  tag: [],
});

describe('tagPairs', () => {
  it('formats tags as "key: value"', () => {
    expect(tagPairs({ env: 'prod', owner: 'net' })).toEqual([
      'env: prod',
      'owner: net',
    ]);
    expect(tagPairs()).toEqual([]);
  });
});

describe('matchesFilters', () => {
  it('matches everything with no filters', () => {
    expect(ITEMS.every((i) => matchesFilters(i, none(), VALUES))).toBe(true);
  });

  it('ORs values within a filter and ANDs across filters', () => {
    const filters = {
      ...none(),
      location: ['eastus', 'westus'],
      resourceGroup: ['rg-hub'],
    };
    expect(
      ITEMS.filter((i) => matchesFilters(i, filters, VALUES)).map(
        (i) => i.name,
      ),
    ).toEqual(['fw-a', 'fw-b']);
  });

  it('can ignore one filter', () => {
    const filters = { ...none(), location: ['westus'] };
    expect(matchesFilters(ITEMS[0], filters, VALUES)).toBe(false);
    expect(matchesFilters(ITEMS[0], filters, VALUES, 'location')).toBe(true);
  });
});

describe('filterOptions', () => {
  it('counts values among items passing the other filters, sorted', () => {
    const filters = { ...none(), resourceGroup: ['rg-hub'] };
    expect(filterOptions('location', ITEMS, filters, VALUES)).toEqual([
      { value: 'eastus', hint: '1' },
      { value: 'westus', hint: '1' },
    ]);
  });

  it("keeps selected values listed even when they don't occur", () => {
    const filters = { ...none(), location: ['northeurope'] };
    expect(filterOptions('location', ITEMS, filters, VALUES)).toEqual([
      { value: 'eastus', hint: '2' },
      { value: 'northeurope', hint: '0' },
      { value: 'westus', hint: '1' },
    ]);
  });
});

describe('parseFilters', () => {
  it('reads saved filters', () => {
    expect(
      parseFilters(
        JSON.stringify({ location: ['eastus'], tag: ['env: prod'] }),
      ),
    ).toEqual({ ...none(), location: ['eastus'], tag: ['env: prod'] });
  });

  it('falls back to no filters for missing or broken data', () => {
    expect(parseFilters(null)).toEqual(none());
    expect(parseFilters('{not json')).toEqual(none());
    expect(parseFilters('null')).toEqual(none());
    expect(parseFilters('[1,2]')).toEqual(none());
    expect(parseFilters('"text"')).toEqual(none());
  });

  it('drops unknown keys and non-string values', () => {
    expect(
      parseFilters(
        JSON.stringify({
          name: 'fw-a',
          location: ['eastus', 3, null],
          bogus: ['x'],
        }),
      ),
    ).toEqual({ ...none(), location: ['eastus'] });
  });
});
