import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../..', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rote-bu0137-audit-'));
  const data = resolve(root, 'docs/testing/data');
  await Promise.all([
    writeFile(join(directory, 'rote-manifests.json'), await readFile(join(data, 'T20-b2-exact-rote-manifests.json'))),
    writeFile(join(directory, 'rote-trajectories.jsonl'), await readFile(join(data, 'T20-b2-exact-rote-trajectories.jsonl'))),
  ]);
  const dumps = JSON.parse(await readFile(join(data, 'T20-b2-exact-browser-use-dumps.json'), 'utf8'));
  for (const dump of dumps) dump.browser_use_version = '0.13.7';
  await writeFile(join(directory, 'browser-use-dumps.json'), `${JSON.stringify(dumps)}\n`);
  return { directory, dumps };
}

async function run(directory) {
  return exec('node', [
    resolve(root, 'scripts/bench/browser-use-refresh/audit-certification-evidence.mjs'),
    directory,
    join(directory, 'audit.json'),
  ], { cwd: root });
}

test('reconciles every Rote and Browser Use provider receipt', async () => {
  const { directory } = await fixture();
  try {
    await run(directory);
    const audit = JSON.parse(await readFile(join(directory, 'audit.json'), 'utf8'));
    assert.deepEqual(audit, {
      protocol_id: 'p1-g2-fixtures-v3-b2-browser-use-0137-paired',
      rote_runs: 18,
      rote_trajectory_events: 180,
      rote_provider_receipts: 180,
      browser_use_runs: 18,
      browser_use_provider_receipts: 76,
      all_usage_reconciled: true,
      all_successes_independently_verified: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a Browser Use aggregate that differs from raw receipts', async () => {
  const { directory, dumps } = await fixture();
  try {
    dumps[0].input_tokens += 1;
    await writeFile(join(directory, 'browser-use-dumps.json'), `${JSON.stringify(dumps)}\n`);
    await assert.rejects(run(directory), /does not reconcile to raw provider receipts/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
