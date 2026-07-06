#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const recorderBin = resolve(repoRoot, 'packages/recorder/bin/rote-record.js');
const fakeDownstream = resolve(repoRoot, 'packages/executor/test/fixtures/fake-browser-downstream.mjs');
const usageFile = process.env.ROTE_USAGE_FILE;
if (!usageFile) throw new Error('ROTE_USAGE_FILE is required');

const child = spawn(process.execPath, [recorderBin, process.execPath, fakeDownstream], {
  cwd: repoRoot,
  env: { ...process.env, ROTE_TARGET_IDENTITY: 'reports.acme.com' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

if (!child.stdin || !child.stdout) throw new Error('failed to open recorder stdio');
const responses = new Map();
createInterface({ input: child.stdout, terminal: false }).on('line', (line) => {
  const msg = JSON.parse(line);
  responses.set(msg.id, msg);
});

async function call(id, name, args) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
  while (!responses.has(id)) await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1));
}

let id = 1;
for (let i = 0; i < 35; i += 1) {
  await call(id, 'browser.click', { selector: `#explore-dead-end-${i}` });
  id += 1;
}
await call(id++, 'browser.navigate', { url: 'https://reports.acme.com/login' });
await call(id++, 'browser.fill', { selector: '#username', value: 'demo' });
await call(id++, 'browser.fill', { selector: '#password', value: 'secret' });
await call(id++, 'browser.click', { selector: '#login-submit' });
await call(id++, 'browser.download_file', { selector: '#latest-report-download' });
child.stdin.end();

const exitCode = await new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code ?? 1)));
mkdirSync(dirname(usageFile), { recursive: true });
writeFileSync(usageFile, `${JSON.stringify([{ source: 'planner', input_tokens: 160000, output_tokens: 40000 }], null, 2)}\n`);
process.exitCode = exitCode;
