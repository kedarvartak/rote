import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../..', import.meta.url));
const runner = join(root, 'scripts/bench/magnitude/run-qualification.mjs');

test('recovers an interrupted attempt as abandoned without rerunning it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rote-magnitude-resume-'));
  const receiptsPath = join(directory, 'receipts.jsonl');
  const checkpointPath = join(directory, 'attempt-01/checkpoint.json');
  try {
    await writeFile(receiptsPath, '');
    await writeFile(join(directory, 'pending.json'), `${JSON.stringify({
      schema_version: 1,
      protocol_id: 'magnitude-core-v0.3.1-b2-qualification-v1',
      attempt: 1,
      checkpoint_path: checkpointPath,
      started_at: '2026-08-04T00:00:00.000Z',
    })}\n`);
    await exec('node', [runner, receiptsPath], {
      cwd: root,
      env: { ...process.env, MAGNITUDE_TEST_ONLY_RECOVER: '1' },
    });
    await exec('node', [runner, receiptsPath], {
      cwd: root,
      env: { ...process.env, MAGNITUDE_TEST_ONLY_RECOVER: '1' },
    });
    const receipts = (await readFile(receiptsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(receipts.length, 1);
    assert.deepEqual(receipts[0], {
      ...receipts[0],
      attempt: 1,
      outcome: 'abandoned',
      aggregate_usage: null,
      aggregate_usage_events: null,
      duration_ms: null,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
