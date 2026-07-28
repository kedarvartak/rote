import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rote-stagehand-reproduce-'));
try {
  const data = join(root, 'docs/testing/data');
  const report = join(temporary, 'report.md');
  const summary = join(temporary, 'summary.json');
  const records = join(temporary, 'records.json');
  await exec('node', [
    join(root, 'packages/bench/bin/rote-bench.js'), 'stagehand-qualification',
    join(data, 'T22-stagehand-qualification-receipts.jsonl'),
    '--records', records, '--out', report, '--summary', summary,
  ], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  for (const [actual, expected] of [
    [report, join(root, 'docs/testing/T22-stagehand-level-report.md')],
    [summary, join(data, 'T22-stagehand-qualification-summary.json')],
    [records, join(data, 'T22-stagehand-neutral-records.json')],
  ]) {
    const [left, right] = await Promise.all([readFile(actual), readFile(expected)]);
    if (!left.equals(right)) throw new Error(`reproduced artifact differs from ${expected}`);
  }
  console.log('Stagehand reproduction passed: report, decision, and records match T22 byte-for-byte');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
