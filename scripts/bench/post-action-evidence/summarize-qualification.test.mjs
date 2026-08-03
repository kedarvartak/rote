import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../..', import.meta.url));
const data = join(root, 'docs/testing/data');

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rote-post-action-summary-'));
  await Promise.all([
    copyFile(join(data, 'T26-post-action-evidence-raw-runs.json'), join(directory, 'raw-runs.json')),
    copyFile(join(data, 'T26-post-action-evidence-manifests.json'), join(directory, 'manifests.json')),
    copyFile(join(data, 'T26-post-action-evidence-trajectories.jsonl'), join(directory, 'trajectories.jsonl')),
  ]);
  return directory;
}

async function summarize(directory) {
  return exec('node', [
    join(root, 'scripts/bench/post-action-evidence/summarize-qualification.mjs'),
    directory,
    join(directory, 'report.md'),
    join(directory, 'summary.json'),
    join(data, 'T26-post-action-evidence-protocol.json'),
  ], { cwd: root });
}

test('rejects a non-done action with missing post-action evidence', async () => {
  const directory = await fixture();
  try {
    const lines = (await readFile(join(directory, 'trajectories.jsonl'), 'utf8')).trim().split('\n');
    const event = JSON.parse(lines[0]);
    delete event.result_ref.value.post_action_evidence;
    lines[0] = JSON.stringify(event);
    await writeFile(join(directory, 'trajectories.jsonl'), `${lines.join('\n')}\n`);
    await assert.rejects(summarize(directory), /strong effect did not pass/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects normalized usage that differs from its raw provider receipt', async () => {
  const directory = await fixture();
  try {
    const lines = (await readFile(join(directory, 'trajectories.jsonl'), 'utf8')).trim().split('\n');
    const event = JSON.parse(lines[0]);
    event.result_ref.value.provider_receipts[0].usage.input_tokens += 1;
    lines[0] = JSON.stringify(event);
    await writeFile(join(directory, 'trajectories.jsonl'), `${lines.join('\n')}\n`);
    await assert.rejects(summarize(directory), /does not reconcile to its provider receipt/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
