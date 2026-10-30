import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TokenCacheContext } from '@azure/msal-node';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-azfw-tokens-'));
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
  },
}));

const { EncryptedCachePlugin, deleteTokenCache } = await import('./tokenCache');
const cacheFile = path.join(userData, 'msal-cache.bin');

const changed = (contents: string) =>
  ({
    cacheHasChanged: true,
    tokenCache: { serialize: () => contents, deserialize: vi.fn() },
  }) as unknown as TokenCacheContext;

beforeEach(async () => {
  fs.rmSync(cacheFile, { recursive: true, force: true });
  await deleteTokenCache();
});
afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

describe('EncryptedCachePlugin', () => {
  it('handles concurrent writes, keeping the latest cache', async () => {
    const plugin = new EncryptedCachePlugin();
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((x) => plugin.afterCacheAccess(changed(x))),
    );
    expect(fs.readFileSync(cacheFile, 'utf8')).toBe('enc:d');
    expect(fs.existsSync(`${cacheFile}.tmp`)).toBe(false);
  });

  it('reads back what it wrote', async () => {
    const plugin = new EncryptedCachePlugin();
    await plugin.afterCacheAccess(changed('tokens'));
    const ctx = changed('');
    await plugin.beforeCacheAccess(ctx);
    expect(ctx.tokenCache.deserialize).toHaveBeenCalledWith('tokens');
  });

  it('lets a pending write finish on close, so the cache can then be deleted for good', async () => {
    const plugin = new EncryptedCachePlugin();
    const write = plugin.afterCacheAccess(changed('tokens'));
    await plugin.close();
    await deleteTokenCache();
    await write;
    expect(fs.existsSync(cacheFile)).toBe(false);
    await plugin.afterCacheAccess(changed('more'));
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it("doesn't fail token requests when the cache can't be saved", async () => {
    fs.mkdirSync(path.join(cacheFile, 'blocker'), { recursive: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = new EncryptedCachePlugin();
    await expect(
      plugin.afterCacheAccess(changed('tokens')),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
