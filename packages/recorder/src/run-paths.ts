import { join } from 'node:path';

/** Filesystem layout for one run's recorded artifacts. Pure — no I/O. */
export interface RunPaths {
  runDir: string;
  trajectoryPath: string;
  manifestPath: string;
  blobsDir: string;
}

/** Computes where a run's files live under `baseDir` (default `.rote`). Pure. */
export function runPaths(baseDir: string, runId: string): RunPaths {
  const runDir = join(baseDir, 'runs', runId);
  return {
    runDir,
    trajectoryPath: join(runDir, 'trajectory.jsonl'),
    manifestPath: join(runDir, 'manifest.json'),
    blobsDir: join(runDir, 'blobs'),
  };
}

/** Content-addressed path for a blob given its SHA-256 hex digest. Pure. */
export function blobPath(blobsDir: string, sha256: string): string {
  return join(blobsDir, `${sha256}.json`);
}

/** Lists the base directory under which every run lives. Pure. */
export function runsRootDir(baseDir: string): string {
  return join(baseDir, 'runs');
}
