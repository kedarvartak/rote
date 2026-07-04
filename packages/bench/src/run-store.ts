import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseTrajectoryJsonl, RunManifestSchema, writeTrajectoryJsonl, type RunManifest, type TrajectoryEvent } from '@rote/core';
import { runPaths } from '@rote/recorder';

/** Reads one recorded run from the standard `.rote/runs/<run_id>` layout. */
export async function readRecordedRun(baseDir: string, runId: string): Promise<{ manifest: RunManifest; trajectory: TrajectoryEvent[] }> {
  const paths = runPaths(baseDir, runId);
  const [manifestText, trajectoryText] = await Promise.all([
    readFile(paths.manifestPath, 'utf8'),
    readFile(paths.trajectoryPath, 'utf8'),
  ]);
  return {
    manifest: RunManifestSchema.parse(JSON.parse(manifestText)),
    trajectory: parseTrajectoryJsonl(trajectoryText),
  };
}

/** Writes raw JSONL trajectories for successful cells into a reproducibility export directory. */
export async function exportSuccessfulTrajectories(
  outDir: string,
  runs: readonly { runId: string; trajectory: TrajectoryEvent[] }[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const run of [...runs].sort((a, b) => a.runId.localeCompare(b.runId))) {
    const path = join(outDir, `${run.runId}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, writeTrajectoryJsonl(run.trajectory), 'utf8');
    paths.push(path);
  }
  return paths;
}
