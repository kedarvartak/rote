import { describe, expect, it } from 'vitest';
import { blobPath, runPaths, runsRootDir } from '../src/run-paths.js';

describe('runPaths', () => {
  it('nests trajectory, manifest, and blobs under runs/<runId>', () => {
    const paths = runPaths('.rote', 'run-123');
    expect(paths.runDir).toBe('.rote/runs/run-123');
    expect(paths.trajectoryPath).toBe('.rote/runs/run-123/trajectory.jsonl');
    expect(paths.manifestPath).toBe('.rote/runs/run-123/manifest.json');
    expect(paths.blobsDir).toBe('.rote/runs/run-123/blobs');
  });

  it('gives two run ids two disjoint run dirs', () => {
    const a = runPaths('.rote', 'run-a');
    const b = runPaths('.rote', 'run-b');
    expect(a.runDir).not.toBe(b.runDir);
  });
});

describe('blobPath', () => {
  it('keys the blob path by sha256', () => {
    const path = blobPath('.rote/runs/run-1/blobs', 'a'.repeat(64));
    expect(path).toBe(`.rote/runs/run-1/blobs/${'a'.repeat(64)}.json`);
  });
});

describe('runsRootDir', () => {
  it('is the parent of every run dir', () => {
    expect(runsRootDir('.rote')).toBe('.rote/runs');
  });
});
