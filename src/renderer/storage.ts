// Settings kept in localStorage. Storage can be unavailable or full; settings are a convenience,
// so failures fall back to defaults rather than breaking the UI.

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value`, or removes the key when it's null. */
export function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not remembered this time.
  }
}
