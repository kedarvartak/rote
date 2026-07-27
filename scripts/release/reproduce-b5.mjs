import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rote-b5-reproduce-'));
const report = join(temporary, 'b5.md');
const summary = join(temporary, 'b5.json');
try {
  const data = join(root, 'docs/testing/data');
  await exec('node', [
    join(root, 'packages/bench/bin/rote-bench.js'), 'b5-report', join(data, 'T21-b5-drift-records.jsonl'),
    '--cold-records', join(data, 'T20-b2-exact-records.json'),
    '--out', report, '--summary', summary, '--min-runs', '15',
  ], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const comparisons = [
    [report, join(root, 'docs/testing/T21-b5-level-report.md')],
    [summary, join(data, 'T21-b5-drift-summary.json')],
  ];
  for (const [actual, expected] of comparisons) {
    const [left, right] = await Promise.all([readFile(actual), readFile(expected)]);
    if (!left.equals(right)) throw new Error(`reproduced artifact differs from ${expected}`);
  }
  console.log('B5 reproduction passed: Markdown and JSON match T21 byte-for-byte');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
