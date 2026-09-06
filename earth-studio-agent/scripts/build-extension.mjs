/**
 * Bundles the extension.
 *
 * The agent is written as TypeScript modules that Node runs directly, but a
 * content script cannot import modules, so each entry point is bundled into one
 * plain script beside the manifest.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'extension');

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: {
    content: resolve(root, 'src/extension/content.ts'),
    panel: resolve(root, 'src/extension/panel.ts'),
    background: resolve(root, 'src/extension/background.ts'),
  },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir,
  logLevel: 'warning',
  legalComments: 'none',
});

// A build of the agent alone, so the same code can be exercised in tests and
// pasted into a console for a one-off run.
await build({
  entryPoints: [resolve(root, 'src/extension/run-in-page.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'EarthStudioAgent',
  target: 'chrome120',
  outfile: resolve(outdir, 'agent.js'),
  logLevel: 'warning',
  legalComments: 'none',
});

console.log(`Built the extension into ${outdir}`);
