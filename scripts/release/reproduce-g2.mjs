import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rote-g2-reproduce-'));
const report = join(temporary, 'g2.md');
const summary = join(temporary, 'g2.json');
try {
  const data = join(root, 'docs/testing/data');
  await exec('node', [
    join(root, 'packages/bench/bin/rote-bench.js'), 'g2-report', join(data, 'T13-g2-records.json'),
    '--rote-manifests', join(data, 'T13-g2-rote-manifests.json'),
    '--browser-dumps', join(data, 'T13-g2-browser-use-dumps.json'),
    '--out', report, '--summary', summary, '--min-runs', '15',
  ], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const comparisons = [
    [report, join(root, 'docs/testing/T13-g2-level-report.md')],
    [summary, join(data, 'T13-g2-summary.json')],
  ];
  for (const [actual, expected] of comparisons) {
    const [left, right] = await Promise.all([readFile(actual), readFile(expected)]);
    if (!left.equals(right)) throw new Error(`reproduced artifact differs from ${expected}`);
  }
  console.log('G2 reproduction passed: Markdown and JSON match T13 byte-for-byte');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
