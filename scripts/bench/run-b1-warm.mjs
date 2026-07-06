#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const replayBin = resolve(repoRoot, 'packages/executor/bin/rote-replay.js');
const playbook = resolve(repoRoot, 'fixtures/playbooks/b1-download-report.yaml');
const fakeDownstream = resolve(repoRoot, 'packages/executor/test/fixtures/fake-browser-downstream.mjs');
const usageFile = process.env.ROTE_USAGE_FILE;
if (!usageFile) throw new Error('ROTE_USAGE_FILE is required');

const child = spawn(
  process.execPath,
  [replayBin, playbook, '--params', JSON.stringify({ username: 'demo', password: 'secret' })],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROTE_DOWNSTREAM_COMMAND: process.execPath,
      ROTE_DOWNSTREAM_ARGS: JSON.stringify([fakeDownstream]),
      ROTE_TARGET_IDENTITY: 'reports.acme.com',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);

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
