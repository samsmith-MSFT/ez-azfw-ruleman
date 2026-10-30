import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';

/*
 * Persists MSAL's token cache (which holds the long-lived refresh token) so sign-in survives
 * restarts. The cache is only ever written encrypted with the OS key store (DPAPI, Keychain,
 * libsecret); when no secure store is available, nothing is written and sign-in lasts for the
 * session only.
 */

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'msal-cache.bin');
}

export function canPersistTokens(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // On Linux without a keyring, Electron falls back to a hard-coded key: treat that as unsafe.
  if (process.platform === 'linux')
    return safeStorage.getSelectedStorageBackend() !== 'basic_text';
  return true;
}

export class EncryptedCachePlugin implements ICachePlugin {
  private closed = false;
  /** Writes run one at a time: MSAL calls afterCacheAccess concurrently (one per directory). */
  private writes: Promise<void> = Promise.resolve();

  async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
    if (this.closed || !canPersistTokens()) return;
    let data: Buffer;
    try {
      data = await fs.promises.readFile(cacheFile());
    } catch {
      return;
    }
    try {
      ctx.tokenCache.deserialize(safeStorage.decryptString(data));
    } catch {
      // Unreadable (e.g. copied from another machine or user): start fresh.
      await deleteTokenCache();
    }
  }

  async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
    if (this.closed || !ctx.cacheHasChanged || !canPersistTokens()) return;
    const data = safeStorage.encryptString(ctx.tokenCache.serialize());
    this.writes = this.writes.then(() =>
      this.write(data).catch((err: Error) => {
        // Not fatal: sign-in still works for this session, it just won't survive a restart.
        console.warn("[auth] Couldn't save the sign-in:", err.message);
      }),
    );
    await this.writes;
  }

  private async write(data: Buffer): Promise<void> {
    if (this.closed) return;
    const target = cacheFile();
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.promises.writeFile(tmp, data, { mode: 0o600 });
    // A sign-out may have happened while writing; never leave tokens behind afterwards.
    if (this.closed) {
      await fs.promises.rm(tmp, { force: true });
      return;
    }
    await fs.promises.rename(tmp, target);
  }

  /** Stops this plugin from reading or writing (used on sign-out); resolves once pending writes end. */
  close(): Promise<void> {
    this.closed = true;
    return this.writes;
  }
}
export async function deleteTokenCache(): Promise<void> {
  const target = cacheFile();
  await Promise.all([
    fs.promises.rm(target, { force: true }),
    fs.promises.rm(`${target}.tmp`, { force: true }),
  ]);
}
