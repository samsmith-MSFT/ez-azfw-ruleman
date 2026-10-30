// The packaged UI is served from a private app:// origin instead of file://. That lets the app
// turn off file://'s extra privileges (see the GrantFileProtocolExtraPrivileges fuse) and trust
// exactly one origin, rather than any local HTML file.
import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEME = 'app';
const HOST = 'bundle';
export const APP_ORIGIN = `${SCHEME}://${HOST}`;

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/** Serves files under `root` (the built renderer) at app://bundle/…; nothing outside it. */
export function serveAppFiles(root: string): void {
  const base = path.resolve(root);
  protocol.handle(SCHEME, (request) => {
    const file = resolveAppFile(base, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** Maps an app://bundle/… URL to a file under `base`; undefined for anything else. */
export function resolveAppFile(base: string, url: string): string | undefined {
  let relative: string;
  try {
    const u = new URL(url);
    if (u.host !== HOST) return undefined;
    relative = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  } catch {
    // Malformed URL or percent-encoding.
    return undefined;
  }
  const file = path.resolve(base, relative || 'index.html');
  return file.startsWith(base + path.sep) ? file : undefined;
}

/**
 * Whether a URL is the app's own UI: the dev server in development, app://bundle when packaged.
 * Used to gate navigation, permissions and every IPC call.
 */
export function isAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
      return u.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    return u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
}
