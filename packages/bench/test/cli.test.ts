import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTrajectoryJsonl } from '@rote/core';
import { runPaths } from '@rote/recorder';
import { main } from '../src/cli.js';
import { event, manifest } from './helpers.js';

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-bench-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('rote-bench CLI', () => {
  it('validates the curve protocol and writes non-evidentiary dry-run JSONL', async () => {
    const root = await tempDir();
    const outPath = join(root, 'curve-dry-run.jsonl');
    const protocolPath = resolve('../../scripts/bench/curve/protocol.json');

    await expect(main(['curve-dry-run', protocolPath, '--out', outPath])).resolves.toBe(
      `wrote ${outPath} (77 dry-run step records)`,
    );
    const lines = (await readFile(outPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(77);
    expect(JSON.parse(lines[0]!)).toEqual(expect.objectContaining({ record_kind: 'dry_run', task_id: 'WP-N07' }));
  });

  it('writes a synthetic benchmark pack and evaluates the M3 gate', async () => {
    const root = await tempDir();
    const specPath = join(root, 'bench-spec.json');

    await expect(main(['synthetic', root])).resolves.toBe(`wrote synthetic benchmark pack: ${specPath} and ${join(root, 'report.md')}`);
    await expect(readFile(join(root, 'report.md'), 'utf8')).resolves.toContain('| B1 | 200000 | 18000 | 91.0% | 40 | 6 | 85.0% |');
    await expect(main(['gate', specPath])).resolves.toContain('M3 gate: PASS');
    await expect(main(['gate', specPath, '--min-token-reduction', '0.95'])).rejects.toThrow('M3 gate: FAIL');
  });

  it('reports and gates serializer parity from captured Browser Use observations', async () => {
    const root = await tempDir();
    const htmlPath = join(root, 'page.html');
    const baselinePath = join(root, 'browser-use.txt');
    const specPath = join(root, 'serializer-spec.json');
    const reportPath = join(root, 'serializer-report.md');
    await writeFile(htmlPath, '<label for="query">Search</label><input id="query" />', 'utf8');
    await writeFile(baselinePath, 'browser use observation '.repeat(20), 'utf8');
    await writeFile(specPath, JSON.stringify({
      fixtures: [{ id: 'B3', html_path: 'page.html', browser_use_observation_path: 'browser-use.txt' }],
    }), 'utf8');

    await expect(main(['serializer-report', specPath, '--out', reportPath])).resolves.toBe(`wrote ${reportPath}`);
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('Overall: PASS');
    await expect(main(['serializer-gate', specPath])).resolves.toContain('Overall: PASS');

    await writeFile(baselinePath, 'x', 'utf8');
    await expect(main(['serializer-gate', specPath])).rejects.toThrow('serializer parity gate failed: B3');
  });

  it('writes a report and raw JSONL export from a benchmark spec', async () => {
    const root = await tempDir();
    const baseDir = join(root, '.rote');
    const reportPath = join(root, 'report.md');
    const exportDir = join(root, 'raw');
    const specPath = join(root, 'spec.json');
    const usagePath = join(root, 'usage.json');
    const paths = runPaths(baseDir, 'cold-1');
    await mkdir(dirname(paths.manifestPath), { recursive: true });
    await writeFile(paths.manifestPath, `${JSON.stringify(manifest('cold-1', []))}\n`, 'utf8');
    await writeFile(paths.trajectoryPath, writeTrajectoryJsonl([event('cold-1', 0)]), 'utf8');
    await writeFile(usagePath, JSON.stringify([{ source: 'planner', input_tokens: 10, output_tokens: 5 }]), 'utf8');
    await writeFile(
      specPath,
      JSON.stringify({
        base_dir: baseDir,
        runs: [{ task: { id: 'B1', name: 'one' }, phase: 'cold', repetition: 1, run_id: 'cold-1', usage_file: 'usage.json' }],
      }),
      'utf8',
    );

    await expect(main(['report', specPath, '--out', reportPath, '--export-jsonl', exportDir])).resolves.toBe(
      `wrote ${reportPath} and ${join(exportDir, '<run_id>.jsonl')}`,
    );
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('| B1 | cold | 1 | 1 | 0 | 15 | 1 | 1000 |');
    await expect(readFile(join(exportDir, 'cold-1.jsonl'), 'utf8')).resolves.toBe(writeTrajectoryJsonl([event('cold-1', 0)]));
  });
});
