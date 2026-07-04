import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTrajectoryJsonl } from '@rote/core';
import { runPaths } from '@rote/recorder';
import { cellsFromSpec, parseBenchmarkSpec } from '../src/spec.js';
import { event, manifest } from './helpers.js';

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-bench-spec-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('benchmark spec', () => {
  it('rejects malformed specs with readable paths', () => {
    expect(() => parseBenchmarkSpec({ runs: [{ task: { id: 'B1', name: 'one' }, phase: 'maybe', repetition: 1, run_id: 'r1' }] })).toThrow(
      'runs[0].phase must be cold, warm, or drift',
    );
    expect(() => parseBenchmarkSpec({ runs: [{ task: { id: 'B1', name: 'one' }, phase: 'cold', repetition: 0, run_id: 'r1' }] })).toThrow(
      'runs[0].repetition must be a positive integer',
    );
  });

  it('loads successful and failed cells from the standard run store with usage sidecars', async () => {
    const baseDir = await tempDir();
    const specDir = await tempDir();
    const usagePath = join(specDir, 'usage.json');
    const paths = runPaths(baseDir, 'r1');
    await mkdir(dirname(paths.manifestPath), { recursive: true });
    await writeFile(paths.manifestPath, `${JSON.stringify(manifest('r1', []))}\n`, 'utf8');
    await writeFile(paths.trajectoryPath, writeTrajectoryJsonl([event('r1', 0)]), 'utf8');
    await writeFile(usagePath, JSON.stringify({ token_usage: [{ source: 'planner', input_tokens: 10, output_tokens: 5 }] }), 'utf8');

    const cells = await cellsFromSpec(
      parseBenchmarkSpec({
        base_dir: baseDir,
        runs: [
          { task: { id: 'B1', name: 'one' }, phase: 'cold', repetition: 1, run_id: 'r1', usage_file: 'usage.json' },
          { task: { id: 'B1', name: 'one' }, phase: 'warm', repetition: 1, error: 'fallback' },
        ],
      }),
      { specDir },
    );

    expect(cells).toEqual([
      expect.objectContaining({
        status: 'success',
        runId: 'r1',
        manifest: expect.objectContaining({ token_usage: [{ source: 'planner', input_tokens: 10, output_tokens: 5 }] }),
      }),
      expect.objectContaining({ status: 'failure', phase: 'warm', error: 'fallback' }),
    ]);
  });
});
