import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const project = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(project, 'scripts/bench/headhead/assemble-certification-evidence.mjs');

test('assembles one-to-one attempt evidence', async () => {
  const root = await fixture();
  try {
    await exec('node', [script, root]);
    const manifests = JSON.parse(await readFile(join(root, 'evidence/rote-manifests.json'), 'utf8'));
    const dumps = JSON.parse(await readFile(join(root, 'evidence/browser-use-dumps.json'), 'utf8'));
    assert.deepEqual(manifests, [{ run_id: 'r1' }]);
    assert.deepEqual(dumps, [{ task: 'B1', repetition: 1 }]);
    assert.equal(await readFile(join(root, 'evidence/rote-trajectories.jsonl'), 'utf8'), '{"run_id":"r1"}\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects evidence count mismatch', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'browser-use/raw-runs.json'), '[]\n');
    await assert.rejects(exec('node', [script, root]), /evidence count mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rote-cert-evidence-'));
  await Promise.all([
    mkdir(join(root, 'rote/.rote/runs/r1'), { recursive: true }),
    mkdir(join(root, 'browser-use/raw'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, 'rote/raw-runs.json'), '[{}]\n'),
    writeFile(join(root, 'browser-use/raw-runs.json'), '[{}]\n'),
    writeFile(join(root, 'rote/.rote/runs/r1/manifest.json'), '{"run_id":"r1"}\n'),
    writeFile(join(root, 'rote/.rote/runs/r1/trajectory.jsonl'), '{"run_id":"r1"}\n'),
    writeFile(join(root, 'browser-use/raw/b1-r01.json'), '{"task":"B1","repetition":1}\n'),
  ]);
  return root;
}
