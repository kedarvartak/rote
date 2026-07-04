import { readdir, readFile } from 'node:fs/promises';
import { parseTrajectoryJsonl, RunManifestSchema, type RunManifest, type TrajectoryEvent } from '@rote/core';
import { runPaths, runsRootDir } from '@rote/recorder';

export interface RunSummary {
  run_id: string;
  manifest?: RunManifest;
}

/**
 * Lists every run under `<baseDir>/runs`. A run directory with no
 * `manifest.json` yet (session still in progress, or the process was
 * killed before session end) is still listed — `manifest` is left
 * undefined rather than the listing silently omitting it.
 */
export async function listRuns(baseDir: string): Promise<RunSummary[]> {
  let runIds: string[];
  try {
    runIds = await readdir(runsRootDir(baseDir));
  } catch {
    return [];
  }
  const summaries = await Promise.all(
    runIds.map(async (runId): Promise<RunSummary> => {
      const manifest = await readManifest(baseDir, runId);
      return { run_id: runId, manifest };
    }),
  );
  return summaries.sort((a, b) => a.run_id.localeCompare(b.run_id));
}

export interface RunDetail {
  run_id: string;
  manifest?: RunManifest;
  events: TrajectoryEvent[];
}

/** Reads one run's manifest + full trajectory for `rote runs show`. */
export async function showRun(baseDir: string, runId: string): Promise<RunDetail> {
  const paths = runPaths(baseDir, runId);
  const manifest = await readManifest(baseDir, runId);
  let events: TrajectoryEvent[] = [];
  try {
    events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
  } catch {
    events = [];
  }
  return { run_id: runId, manifest, events };
}

async function readManifest(baseDir: string, runId: string): Promise<RunManifest | undefined> {
  const paths = runPaths(baseDir, runId);
  try {
    const parsed: unknown = JSON.parse(await readFile(paths.manifestPath, 'utf8'));
    return RunManifestSchema.parse(parsed);
  } catch {
    return undefined;
  }
}
