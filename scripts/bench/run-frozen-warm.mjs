#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const task = process.argv[2];
if (!['B2', 'B3'].includes(task)) throw new Error('usage: run-frozen-warm.mjs B2|B3');

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const replayBin = resolve(repoRoot, 'packages/executor/bin/rote-replay.js');
const fakeDownstream = resolve(repoRoot, 'scripts/bench/fake-browser-downstream.mjs');
const playbook = task === 'B2'
  ? resolve(repoRoot, 'scripts/bench/playbooks/b2-vendor-registration-smoke.yaml')
  : resolve(repoRoot, 'fixtures/playbooks/b3-catalog-search.yaml');
const params = task === 'B2'
  ? {
      company_name: 'Globex LLC',
      contact_email: 'ops@globex.example',
      tax_id: '98-7654321',
      address_line1: '1 Market St',
      city: 'Metropolis',
      postal_code: '94105',
      country: 'US',
      phone: '+1-555-0100',
    }
  : { query: 'widgets', limit: 3 };
const usageFile = process.env.ROTE_USAGE_FILE;
if (!usageFile) throw new Error('ROTE_USAGE_FILE is required');

const child = spawn(process.execPath, [replayBin, playbook, '--params', JSON.stringify(params)], {
  cwd: repoRoot,
  env: {
    ...process.env,
    ROTE_DOWNSTREAM_COMMAND: process.execPath,
    ROTE_DOWNSTREAM_ARGS: JSON.stringify([fakeDownstream]),
    ROTE_TARGET_IDENTITY: task === 'B2' ? 'vendors.acme.com' : 'catalog.acme.com',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const exitCode = await new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code ?? 1)));
if (exitCode === 0) normalizeExecutorRunId();
mkdirSync(dirname(usageFile), { recursive: true });
writeFileSync(
  usageFile,
  `${JSON.stringify([
    { source: 'matcher', input_tokens: 12000, output_tokens: 1000 },
    { source: 'verify', input_tokens: 4500, output_tokens: 500 }
  ], null, 2)}\n`,
);
process.exitCode = exitCode;

function normalizeExecutorRunId() {
  const expected = process.env.ROTE_RUN_ID;
  const baseDir = process.env.ROTE_BASE_DIR;
  if (!expected || !baseDir) return;
  const runsDir = join(baseDir, 'runs');
  const expectedDir = join(runsDir, expected);
  if (existsSync(expectedDir)) return;
  const candidates = readdirSync(runsDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !/^[a-z0-9]+-(cold|warm|drift)-\d+$/.test(entry.name),
  );
  if (candidates.length !== 1) throw new Error(`expected one replay run to normalize, found ${candidates.length}`);
  renameSync(join(runsDir, candidates[0].name), expectedDir);
}
