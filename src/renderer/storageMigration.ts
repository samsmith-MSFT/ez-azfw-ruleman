const OLD_PREFIX = 'azurenetman.';
const NEW_PREFIX = 'ez-azfw-ruleman.';

/**
 * Settings saved before the app was renamed (filters, auto-refresh, activity…) used the old key
 * prefix; copy them to the new keys once so nothing is lost. A value already saved under the new
 * key wins.
 */
export function migrateStoredSettings(target?: Storage): void {
  try {
    const storage = target ?? localStorage;
    const oldKeys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(OLD_PREFIX)) oldKeys.push(key);
    }
    for (const key of oldKeys) {
      const next = NEW_PREFIX + key.slice(OLD_PREFIX.length);
      const value = storage.getItem(key);
      if (value !== null && storage.getItem(next) === null)
        storage.setItem(next, value);
      storage.removeItem(key);
    }
  } catch {
    // Storage unavailable: the app just starts with default settings.
  }
}
