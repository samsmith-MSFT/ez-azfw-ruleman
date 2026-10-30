// Builds a portable, double-click-to-run release for the current OS:
//   Windows -> single-file portable .exe
//   Linux   -> AppImage
//   macOS   -> zipped .app
// Electron Forge builds and hardens the app (Vite bundles, fuses, optional signing), then
// electron-builder wraps that exact output; see electron-builder.yml.
//
// Usage: npm run dist [-- --arch x64|arm64]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);

const { values } = parseArgs({
  options: { arch: { type: 'string', default: process.arch } },
});
const arch = values.arch;
if (!['x64', 'arm64'].includes(arch)) {
  console.error(`Unsupported --arch "${arch}". Use x64 or arm64.`);
  process.exit(1);
}

const platform = process.platform;
const builderFlag = { win32: '--win', linux: '--linux', darwin: '--mac' }[
  platform
];
if (!builderFlag) {
  console.error(`Unsupported platform "${platform}".`);
  process.exit(1);
}

const { productName } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packaged = path.join('out', `${productName}-${platform}-${arch}`);
const prepackaged =
  platform === 'darwin' ? path.join(packaged, `${productName}.app`) : packaged;

// electron-builder signs the Windows portable wrapper with the same certificate Forge uses
// for the app itself, when one is configured.
const env = { ...process.env };
if (platform === 'win32' && env.WINDOWS_CERTIFICATE_FILE) {
  env.CSC_LINK = env.WINDOWS_CERTIFICATE_FILE;
  env.CSC_KEY_PASSWORD = env.WINDOWS_CERTIFICATE_PASSWORD ?? '';
}

/** Runs a package's CLI with the current Node, so no shell (or argument quoting) is involved. */
function run(pkgName, binName, args) {
  const manifest = require.resolve(`${pkgName}/package.json`);
  const { bin } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const script = path.join(
    path.dirname(manifest),
    typeof bin === 'string' ? bin : bin[binName],
  );
  console.log(`\n> ${binName} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('@electron-forge/cli', 'electron-forge', ['package', '--arch', arch]);
run('electron-builder', 'electron-builder', [
  '--prepackaged',
  prepackaged,
  builderFlag,
  `--${arch}`,
]);
