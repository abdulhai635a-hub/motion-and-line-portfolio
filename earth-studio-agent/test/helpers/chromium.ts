/**
 * Finds a Chromium the browser tests can drive.
 *
 * Playwright's own download is used when it is present. Environments that ship a
 * preinstalled browser (CI images, this repo's cloud sandbox) can point at one
 * with EARTH_STUDIO_CHROMIUM, or have it discovered under
 * PLAYWRIGHT_BROWSERS_PATH. When no browser is available the browser tests skip
 * instead of failing, so `npm test` still works on a machine without browsers.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export function findChromium(): string | undefined {
  const fromEnv = process.env.EARTH_STUDIO_CHROMIUM;
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) return fromEnv;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root === undefined || root === '' || !existsSync(root)) return undefined;
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = join(root, entry, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
