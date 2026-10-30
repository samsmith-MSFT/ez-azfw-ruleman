import { describe, it, expect } from 'vitest';
import { migrateStoredSettings } from './storageMigration';

/** A minimal in-memory Storage. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
}

const contents = (s: Storage) =>
  Object.fromEntries(
    Array.from({ length: s.length }, (_, i) => {
      const k = s.key(i)!;
      return [k, s.getItem(k)];
    }),
  );

describe('migrateStoredSettings', () => {
  it('moves settings from the old key prefix to the new one', () => {
    const s = memoryStorage({
      'azurenetman.blade': 'collapsed',
      'azurenetman.firewallFilters': '{"location":["eastus"]}',
      unrelated: '1',
    });
    migrateStoredSettings(s);
    expect(contents(s)).toEqual({
      'ez-azfw-ruleman.blade': 'collapsed',
      'ez-azfw-ruleman.firewallFilters': '{"location":["eastus"]}',
      unrelated: '1',
    });
  });

  it('keeps a value already saved under the new key', () => {
    const s = memoryStorage({
      'azurenetman.blade': 'collapsed',
      'ez-azfw-ruleman.blade': 'open',
    });
    migrateStoredSettings(s);
    expect(contents(s)).toEqual({ 'ez-azfw-ruleman.blade': 'open' });
  });

  it('does nothing when there is nothing to migrate', () => {
    const s = memoryStorage({ 'ez-azfw-ruleman.blade': 'open' });
    migrateStoredSettings(s);
    expect(contents(s)).toEqual({ 'ez-azfw-ruleman.blade': 'open' });
  });

  it('ignores storage errors', () => {
    const broken = {
      get length(): number {
        throw new Error('denied');
      },
    } as Storage;
    expect(() => migrateStoredSettings(broken)).not.toThrow();
  });
});
