import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rote-browser-use-0137-cert-reproduce-'));
try {
  const data = join(root, 'docs/testing/data');
  const report = join(temporary, 'report.md');
  const summary = join(temporary, 'summary.json');
  const audit = join(temporary, 'receipt-audit.json');
  const roteRecords = join(temporary, 'rote-records.json');
  const browserRecords = join(temporary, 'browser-use-records.json');
  const records = join(temporary, 'records.json');
  const sources = join(temporary, 'sources.json');
  await Promise.all([
    copyFile(join(data, 'T25-browser-use-0137-certification-rote-manifests.json'), join(temporary, 'rote-manifests.json')),
    copyFile(join(data, 'T25-browser-use-0137-certification-rote-trajectories.jsonl'), join(temporary, 'rote-trajectories.jsonl')),
    copyFile(join(data, 'T25-browser-use-0137-certification-browser-use-dumps.json'), join(temporary, 'browser-use-dumps.json')),
  ]);
  await exec('node', [join(root, 'scripts/bench/browser-use-refresh/verify-certification-protocol.mjs')], { cwd: root });
  await exec('node', [join(root, 'scripts/bench/browser-use-refresh/audit-certification-evidence.mjs'), temporary, audit], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const bench = join(root, 'packages/bench/bin/rote-bench.js');
  await exec('node', [bench, 'competitor-records', join(data, 'T25-browser-use-0137-certification-rote-raw-runs.json'),
    '--harness', 'rote', '--model', 'gpt-4.1-mini', '--cache-adjusted', 'true',
    '--config-notes', 'Rote c55c492e846a cold agent, exact cache buckets, 1920x1080', '--out', roteRecords], { cwd: root });
  await exec('node', [bench, 'competitor-records', join(data, 'T25-browser-use-0137-certification-browser-use-raw-runs.json'),
    '--harness', 'browser-use', '--model', 'gpt-4.1-mini', '--cache-adjusted', 'true',
    '--config-notes', 'Browser Use 0.13.7 defaults, wheel SHA-256 2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8, exact cache buckets, 1920x1080', '--out', browserRecords], { cwd: root });
  await writeFile(sources, `${JSON.stringify({ subject: { harness: 'rote', records: 'rote-records.json' }, competitors: [{ harness: 'browser-use', records: 'browser-use-records.json' }] })}\n`);
  await exec('node', [bench, 'records', sources, '--out', records], { cwd: root });
  await exec('node', [
    bench, 'g2-report', records,
    '--rote-manifests', join(temporary, 'rote-manifests.json'),
    '--browser-dumps', join(temporary, 'browser-use-dumps.json'),
    '--protocol-id', 'p1-g2-fixtures-v3-b2-browser-use-0137-paired',
    '--min-runs', '15', '--out', report, '--summary', summary,
  ], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  for (const [actual, expected] of [
    [report, join(data, 'T25-browser-use-0137-certification-report.md')],
    [summary, join(data, 'T25-browser-use-0137-certification-summary.json')],
    [audit, join(data, 'T25-browser-use-0137-certification-receipt-audit.json')],
    [records, join(data, 'T25-browser-use-0137-certification-records.json')],
  ]) {
    const [left, right] = await Promise.all([readFile(actual), readFile(expected)]);
    if (!left.equals(right)) throw new Error(`reproduced artifact differs from ${expected}`);
  }
  console.log('Browser Use 0.13.7 paired certification reproduction passed: neutral records, report, summary, and receipt audit match T25 byte-for-byte');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
