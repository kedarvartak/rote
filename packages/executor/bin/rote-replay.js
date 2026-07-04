#!/usr/bin/env node
// See packages/recorder/bin/rote-record.js for why this relays via tsx.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/cli-entry.ts', import.meta.url));
const child = spawn(process.execPath, ['--import', 'tsx/esm', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
