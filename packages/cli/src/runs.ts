import { readdir, readFile } from 'node:fs/promises';
import { parseTrajectoryJsonl, RunManifestSchema, type RunManifest, type TrajectoryEvent } from '@rote/core';
import { runPaths, runsRootDir } from '@rote/recorder';
import { isMissing, readOptional, type ArtifactStatus } from './artifact-status.js';

export interface RunSummary {
  run_id: string;
  manifest?: RunManifest;
  /** `absent` while a run is in progress; `unreadable` if the manifest is corrupt. */
  manifestStatus: ArtifactStatus;
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
  } catch (error) {
    // No runs directory yet is an empty listing; anything else (a permission
    // problem, a file where the directory should be) is not "no runs".
    if (isMissing(error)) return [];
    throw error;
  }
  const summaries = await Promise.all(
    runIds.map(async (runId): Promise<RunSummary> => {
      const { value: manifest, status } = await readManifest(baseDir, runId);
      return { run_id: runId, ...(manifest ? { manifest } : {}), manifestStatus: status };
    }),
  );
  return summaries.sort((a, b) => a.run_id.localeCompare(b.run_id));
}

export interface RunDetail {
  run_id: string;
  manifest?: RunManifest;
  events: TrajectoryEvent[];
  manifestStatus: ArtifactStatus;
  /**
   * INVARIANT: a corrupt trajectory is never rendered as a run with no events.
   * `events` is empty in both cases, so the status is the only thing that tells
   * a reader whether the run recorded nothing or whether its record is damaged.
   */
  trajectoryStatus: ArtifactStatus;
}

/** Reads one run's manifest + full trajectory for `rote runs show`. */
export async function showRun(baseDir: string, runId: string): Promise<RunDetail> {
  const paths = runPaths(baseDir, runId);
  const manifest = await readManifest(baseDir, runId);
  const trajectory = await readOptional(async () =>
    parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8')));
  return {
    run_id: runId,
    ...(manifest.value ? { manifest: manifest.value } : {}),
    events: trajectory.value ?? [],
    manifestStatus: manifest.status,
    trajectoryStatus: trajectory.status,
  };
}

async function readManifest(baseDir: string, runId: string): Promise<{ value?: RunManifest; status: ArtifactStatus }> {
  const paths = runPaths(baseDir, runId);
  return readOptional(async () => RunManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, 'utf8'))));
}
