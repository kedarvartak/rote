import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rote-post-action-evidence-reproduce-'));
try {
  const data = join(root, 'docs/testing/data');
  const report = join(temporary, 'report.md');
  const summary = join(temporary, 'summary.json');
  await Promise.all([
    copyFile(join(data, 'T26-post-action-evidence-raw-runs.json'), join(temporary, 'raw-runs.json')),
    copyFile(join(data, 'T26-post-action-evidence-manifests.json'), join(temporary, 'manifests.json')),
    copyFile(join(data, 'T26-post-action-evidence-trajectories.jsonl'), join(temporary, 'trajectories.jsonl')),
  ]);
  await exec('node', [
    join(root, 'scripts/bench/post-action-evidence/summarize-qualification.mjs'),
    temporary,
    report,
    summary,
    join(data, 'T26-post-action-evidence-protocol.json'),
  ], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  for (const [actual, expected] of [
    [report, join(data, 'T26-post-action-evidence-report.md')],
    [summary, join(data, 'T26-post-action-evidence-summary.json')],
    [join(root, 'scripts/bench/post-action-evidence/protocol.json'), join(data, 'T26-post-action-evidence-protocol.json')],
  ]) {
    const [left, right] = await Promise.all([readFile(actual), readFile(expected)]);
    if (!left.equals(right)) throw new Error(`reproduced artifact differs from ${expected}`);
  }
  console.log('Post-action evidence reproduction passed: T26 report and summary match byte-for-byte');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
