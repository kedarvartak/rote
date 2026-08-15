import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseTrajectoryJsonl, RunManifestSchema, type RunManifest } from '@rote/core';
import { runPaths } from '@rote/recorder';
import type { DistillableEvent } from './distill.js';

/** A recorded browser-agent run loaded from disk: manifest plus events with resolved results. */
export interface LoadedRun {
  runId: string;
  manifest: RunManifest;
  events: DistillableEvent[];
}

/**
 * Loads one recorded run (`<baseDir>/runs/<runId>`) for distillation. Results are
 * resolved from inline refs or content-addressed blobs; nothing is interpreted here.
 * Fails if the manifest is missing or the run did not end in success — the distiller
 * only learns from verified successes.
 */
export async function loadRecordedRun(baseDir: string, runId: string): Promise<LoadedRun> {
  const paths = runPaths(baseDir, runId);
  const manifest = RunManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, 'utf8')));
  if (manifest.outcome !== 'success') {
    throw new Error(`run ${runId} ended with outcome ${manifest.outcome}; only successful runs distill`);
  }
  const events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
  const resolved: DistillableEvent[] = [];
  for (const event of events) {
    const ref = event.result_ref;
    if (ref.kind === 'inline') {
      resolved.push({ event, result: ref.value });
      continue;
    }
    const blobPath = isAbsolute(ref.path) ? ref.path : join(paths.runDir, ref.path);
    resolved.push({ event, result: JSON.parse(await readFile(blobPath, 'utf8')) });
  }
  return { runId, manifest, events: resolved };
}
