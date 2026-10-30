import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Production builds get a strict CSP. The dev server needs inline/HMR scripts, so it is
// only applied at build time.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  // Vite may inline small font subsets as data: URIs.
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'ez-azfw-ruleman-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
});

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), cspPlugin()],
});
