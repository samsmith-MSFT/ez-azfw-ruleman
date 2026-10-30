import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appData = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ez-azfw-ruleman-appdata-'),
);
const setPath = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: () => appData, setPath: (...a: unknown[]) => setPath(...a) },
}));

const legacy = path.join(appData, 'azurenetman');
const target = path.join(appData, 'ez-azfw-ruleman');

beforeEach(() => {
  vi.resetModules();
  setPath.mockReset();
  fs.rmSync(legacy, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(appData, { recursive: true, force: true }));

describe('data folder', () => {
  it('moves the old folder and renames its files', async () => {
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'azurenetman-state.json'), '{"v":1}');
    fs.writeFileSync(path.join(legacy, 'msal-cache.bin'), 'x');
    await import('./userData');
    expect(setPath).toHaveBeenCalledWith('userData', target);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(
      fs.readFileSync(path.join(target, 'ez-azfw-ruleman-state.json'), 'utf8'),
    ).toBe('{"v":1}');
    expect(fs.existsSync(path.join(target, 'msal-cache.bin'))).toBe(true);
  });

  it('uses the new folder when it already exists, leaving any old one alone', async () => {
    fs.mkdirSync(legacy);
    fs.mkdirSync(target);
    await import('./userData');
    expect(setPath).toHaveBeenCalledWith('userData', target);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('starts fresh in the new folder on a new install', async () => {
    await import('./userData');
    expect(setPath).toHaveBeenCalledWith('userData', target);
  });
});
