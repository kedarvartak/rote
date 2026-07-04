import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  it('writes a report and raw JSONL export from a benchmark spec', async () => {
    const root = await tempDir();
    const baseDir = join(root, '.rote');
    const reportPath = join(root, 'report.md');
    const exportDir = join(root, 'raw');
    const specPath = join(root, 'spec.json');
    const paths = runPaths(baseDir, 'cold-1');
    await mkdir(dirname(paths.manifestPath), { recursive: true });
    await writeFile(paths.manifestPath, `${JSON.stringify(manifest('cold-1', [{ source: 'planner', input_tokens: 10, output_tokens: 5 }]))}\n`, 'utf8');
    await writeFile(paths.trajectoryPath, writeTrajectoryJsonl([event('cold-1', 0)]), 'utf8');
    await writeFile(
      specPath,
      JSON.stringify({
        base_dir: baseDir,
        runs: [{ task: { id: 'B1', name: 'one' }, phase: 'cold', repetition: 1, run_id: 'cold-1' }],
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
