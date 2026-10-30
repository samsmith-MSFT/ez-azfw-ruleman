// Renders assets/icons/logo.svg into the app icon formats Electron and the makers need.
// Run with `npm run icons` after changing the logo.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import png2icons from 'png2icons';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'icons',
);
const svg = readFileSync(join(dir, 'logo.svg'), 'utf8');

const render = (size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

const png1024 = render(1024);
writeFileSync(join(dir, 'icon.png'), render(512));

const ico = png2icons.createICO(png1024, png2icons.BICUBIC2, 0, false, true);
const icns = png2icons.createICNS(png1024, png2icons.BICUBIC2, 0);
if (!ico || !icns) throw new Error('Icon conversion failed.');
writeFileSync(join(dir, 'icon.ico'), ico);
writeFileSync(join(dir, 'icon.icns'), icns);

console.log('Wrote icon.png, icon.ico and icon.icns to', dir);
