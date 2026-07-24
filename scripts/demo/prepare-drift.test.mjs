import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));

test('reads demo task and slot values from the canonical benchmark config', async () => {
  const reader = join(root, 'scripts/demo/read-b1-config.mjs');
  const [task, params] = await Promise.all([
    exec('node', [reader, 'task']),
    exec('node', [reader, 'params']),
  ]);
  assert.match(task.stdout, /reports portal/);
  assert.deepEqual(Object.keys(JSON.parse(params.stdout)).sort(), ['password', 'username']);
});

test('prepares deterministic selector drift without changing the success signal', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'rote-demo-drift-'));
  try {
    await exec('node', [join(root, 'scripts/demo/prepare-drift.mjs'), join(root, 'fixtures/sites'), temporary]);
    const html = await readFile(join(temporary, 'b1-report.html'), 'utf8');
    assert.match(html, /id="login-panel-v2"/);
    assert.match(html, /id="report-download-v2"/);
    assert.doesNotMatch(html, /id="login-form"/);
    assert.match(html, /Report download complete: quarterly-report\.pdf/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
