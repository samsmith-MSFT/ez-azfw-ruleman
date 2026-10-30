import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

vi.mock('electron', () => ({ net: {}, protocol: {} }));
vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);

const { isAppUrl, resolveAppFile } = await import('./appProtocol');

const base = path.resolve('renderer-root');

describe('resolveAppFile', () => {
  it('serves files inside the bundle, defaulting to index.html', () => {
    expect(resolveAppFile(base, 'app://bundle/')).toBe(
      path.join(base, 'index.html'),
    );
    expect(resolveAppFile(base, 'app://bundle/assets/a%20b.js')).toBe(
      path.join(base, 'assets', 'a b.js'),
    );
  });

  it('refuses other hosts, escapes and malformed URLs', () => {
    expect(resolveAppFile(base, 'app://other/index.html')).toBeUndefined();
    expect(
      resolveAppFile(base, 'app://bundle/..%2F..%2Fsecret'),
    ).toBeUndefined();
    expect(resolveAppFile(base, 'app://bundle/%E0%A4%A')).toBeUndefined();
    expect(resolveAppFile(base, 'not a url')).toBeUndefined();
  });
});

describe('isAppUrl', () => {
  it('trusts only app://bundle in packaged builds', () => {
    expect(isAppUrl('app://bundle/index.html')).toBe(true);
    expect(isAppUrl('app://evil/index.html')).toBe(false);
    expect(isAppUrl('https://example.com')).toBe(false);
    expect(isAppUrl('file:///C:/index.html')).toBe(false);
    expect(isAppUrl(undefined)).toBe(false);
  });
});
