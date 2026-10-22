import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = new URL('.', import.meta.url);
const dist = new URL('dist/', packageRoot);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL('src/cli-entry.ts', packageRoot))],
  outfile: fileURLToPath(new URL('dist/cli-entry.js', packageRoot)),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  legalComments: 'external',
  external: ['@anthropic-ai/sdk', 'openai', 'ws', 'yaml', 'zod'],
});

await copyFile(new URL('../../LICENSE', packageRoot), new URL('dist/LICENSE', packageRoot));
await mkdir(new URL('dist/gui/', packageRoot), { recursive: true });
await copyFile(new URL('src/gui/index.html', packageRoot), new URL('dist/gui/index.html', packageRoot));
await copyFile(new URL('src/gui/app.css', packageRoot), new URL('dist/gui/app.css', packageRoot));
await build({
  entryPoints: [fileURLToPath(new URL('src/gui/app.ts', packageRoot))],
  outfile: fileURLToPath(new URL('dist/gui/app.js', packageRoot)),
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  sourcemap: true,
});
