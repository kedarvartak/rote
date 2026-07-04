import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTrajectoryJsonl } from '@rote/core';
import { runPaths } from '@rote/recorder';
import { exportSuccessfulTrajectories, readRecordedRun } from '../src/run-store.js';
import { event, manifest } from './helpers.js';

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-bench-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('run-store helpers', () => {
  it('reads a standard recorded run layout', async () => {
    const baseDir = await tempDir();
    const paths = runPaths(baseDir, 'r1');
    const trajectory = [event('r1', 0), event('r1', 1)];
    await mkdir(dirname(paths.manifestPath), { recursive: true });
    await writeFile(paths.manifestPath, `${JSON.stringify(manifest('r1', []))}\n`, 'utf8');
    await writeFile(paths.trajectoryPath, writeTrajectoryJsonl(trajectory), 'utf8');

    await expect(readRecordedRun(baseDir, 'r1')).resolves.toEqual({ manifest: manifest('r1', []), trajectory });
  });

  it('exports successful trajectories in run-id order', async () => {
    const outDir = await tempDir();
    const paths = await exportSuccessfulTrajectories(outDir, [
      { runId: 'b', trajectory: [event('b', 0)] },
      { runId: 'a', trajectory: [event('a', 0)] },
    ]);

    expect(paths.map((path) => path.endsWith('a.jsonl') || path.endsWith('b.jsonl'))).toEqual([true, true]);
    expect(paths[0]?.endsWith('a.jsonl')).toBe(true);
    await expect(readFile(join(outDir, 'a.jsonl'), 'utf8')).resolves.toBe(writeTrajectoryJsonl([event('a', 0)]));
  });
});
