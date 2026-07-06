#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const task = process.argv[2];
if (!['B2', 'B3'].includes(task)) throw new Error('usage: run-frozen-cold.mjs B2|B3');

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const recorderBin = resolve(repoRoot, 'packages/recorder/bin/rote-record.js');
const fakeDownstream = resolve(repoRoot, 'scripts/bench/fake-browser-downstream.mjs');
const usageFile = process.env.ROTE_USAGE_FILE;
if (!usageFile) throw new Error('ROTE_USAGE_FILE is required');

const child = spawn(process.execPath, [recorderBin, process.execPath, fakeDownstream], {
  cwd: repoRoot,
  env: { ...process.env, ROTE_TARGET_IDENTITY: task === 'B2' ? 'vendors.acme.com' : 'catalog.acme.com' },
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
for (let i = 0; i < (task === 'B2' ? 30 : 36); i += 1) {
  await call(id++, 'browser.click', { selector: `#${task.toLowerCase()}-explore-dead-end-${i}` });
}

if (task === 'B2') {
  await call(id++, 'browser.navigate', { url: 'https://vendors.acme.com/register' });
  for (const [selector, value] of [
    ['#company-name', 'Globex LLC'],
    ['#contact-email', 'ops@globex.example'],
    ['#tax-id', '98-7654321'],
    ['#address-line1', '1 Market St'],
    ['#city', 'Metropolis'],
    ['#postal-code', '94105'],
    ['#country', 'US'],
    ['#phone', '+1-555-0100'],
  ]) {
    await call(id++, 'browser.fill', { selector, value });
  }
  await call(id++, 'browser.click', { selector: '#registration-submit' });
} else {
  await call(id++, 'browser.navigate', { url: 'https://catalog.acme.com/search' });
  await call(id++, 'browser.fill', { selector: '#catalog-query', value: 'widgets' });
  await call(id++, 'browser.click', { selector: '#catalog-search-submit' });
  await call(id++, 'browser.extract', { selector: '#catalog-results', limit: 3 });
}

child.stdin.end();
const exitCode = await new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code ?? 1)));
mkdirSync(dirname(usageFile), { recursive: true });
writeFileSync(usageFile, `${JSON.stringify([{ source: 'planner', input_tokens: 168000, output_tokens: 42000 }], null, 2)}\n`);
process.exitCode = exitCode;
