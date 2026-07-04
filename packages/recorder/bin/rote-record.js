#!/usr/bin/env node
// Relays into a `node --import tsx/esm` child so the real entry (src/cli.ts)
// runs straight from TS source: Node can't execute .ts natively under our
// Node>=20 floor, and requiring a monorepo build before the CLI works at
// all would undercut the zero-build dev/test workflow every other package
// already relies on (see packages/recorder/README.md).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/cli-entry.ts', import.meta.url));
const child = spawn(process.execPath, ['--import', 'tsx/esm', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
// A signal delivered to this relay's own PID (e.g. `kill -TERM <pid>`, as
// opposed to Ctrl-C, which already hits the whole foreground process group)
// must reach the real worker, or the worker keeps running orphaned after
// the relay exits. SIGKILL can't be forwarded — no process can act on it,
// relay or not — so that gap is inherent, not specific to this relay.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
