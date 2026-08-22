import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { parseTrajectoryJsonl } from '@rote/core';
import { runPaths, runsRootDir } from '@rote/recorder';

// see docs/testing/T39-predictor-systems.md — confidence is under-calibrated on
// the fixture corpus, so the predictor ships shadow-only until live calibration
// exists. Every product run records its shadow predictions; this command is the
// accumulator that turns those records into the calibration T39 says must be
// measured before any acting threshold is chosen. Buckets and thresholds mirror
// T39's simulation exactly so offline and live numbers are comparable.

const PredictionSchema = z.object({
  prediction: z.object({ confidence: z.number().min(0).max(1), source: z.string(), hit: z.boolean() }).passthrough(),
}).passthrough();

export interface CalibrationBucket {
  bucket: string;
  lower: number;
  upper: number;
  steps: number;
  hits: number;
  hit_rate: number;
  mean_confidence: number;
}

export interface ThresholdRow {
  threshold: number;
  coverage: number;
  precision: number;
  acted: number;
  hits: number;
}

export interface PredictReport {
  runs: number;
  runsWithPredictions: number;
  shadowed: number;
  hits: number;
  hitRate: number;
  bySource: Record<string, { steps: number; hits: number }>;
  calibration: CalibrationBucket[];
  thresholds: ThresholdRow[];
}

const BUCKETS: Array<[number, number]> = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]];
const THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95];

/**
 * Aggregates every recorded run's shadow predictions into hit rate, per-source
 * counts, T39-shaped calibration buckets, and coverage/precision at the T39
 * thresholds. Pure read over `<baseDir>/runs`; runs without predictions count
 * toward `runs` but contribute nothing — the report never invents a sample.
 */
export async function predictReport(baseDir: string): Promise<PredictReport> {
  let runIds: string[] = [];
  try {
    runIds = await readdir(runsRootDir(baseDir));
  } catch {
    runIds = [];
  }
  const samples: Array<{ confidence: number; source: string; hit: boolean }> = [];
  let runsWithPredictions = 0;
  for (const runId of runIds.sort()) {
    const paths = runPaths(baseDir, runId);
    let events;
    try {
      events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
    } catch {
      continue;
    }
    let found = false;
    for (const event of events) {
      const ref = event.result_ref;
      let raw: unknown;
      if (ref.kind === 'inline') raw = ref.value;
      else {
        const blobPath = isAbsolute(ref.path) ? ref.path : join(paths.runDir, ref.path);
        try { raw = JSON.parse(await readFile(blobPath, 'utf8')); } catch { raw = undefined; }
      }
      const parsed = PredictionSchema.safeParse(raw ?? {});
      if (!parsed.success) continue;
      samples.push({ confidence: parsed.data.prediction.confidence, source: parsed.data.prediction.source, hit: parsed.data.prediction.hit });
      found = true;
    }
    if (found) runsWithPredictions += 1;
  }

  const hits = samples.filter((sample) => sample.hit).length;
  const bySource: PredictReport['bySource'] = {};
  for (const sample of samples) {
    const row = bySource[sample.source] ?? { steps: 0, hits: 0 };
    row.steps += 1;
    if (sample.hit) row.hits += 1;
    bySource[sample.source] = row;
  }
  const calibration = BUCKETS.map(([lower, upper]) => {
    // upper-inclusive top bucket so confidence 1.0 lands in 0.8–1.0, as in T39
    const inBucket = samples.filter((sample) => sample.confidence >= lower && (upper === 1 ? sample.confidence <= upper : sample.confidence < upper));
    const bucketHits = inBucket.filter((sample) => sample.hit).length;
    return {
      bucket: `${lower}–${upper}`, lower, upper,
      steps: inBucket.length, hits: bucketHits,
      hit_rate: inBucket.length ? bucketHits / inBucket.length : 0,
      mean_confidence: inBucket.length ? inBucket.reduce((sum, sample) => sum + sample.confidence, 0) / inBucket.length : 0,
    };
  });
  const thresholds = THRESHOLDS.map((threshold) => {
    const acted = samples.filter((sample) => sample.confidence >= threshold);
    const actedHits = acted.filter((sample) => sample.hit).length;
    return {
      threshold,
      coverage: samples.length ? acted.length / samples.length : 0,
      precision: acted.length ? actedHits / acted.length : 0,
      acted: acted.length,
      hits: actedHits,
    };
  });
  return {
    runs: runIds.length, runsWithPredictions,
    shadowed: samples.length, hits,
    hitRate: samples.length ? hits / samples.length : 0,
    bySource, calibration, thresholds,
  };
}

/** Renders the live calibration report for the terminal. */
export function formatPredictReport(report: PredictReport): string {
  const lines = [`shadow predictions across ${report.runsWithPredictions}/${report.runs} recorded runs`];
  if (report.shadowed === 0) {
    lines.push('no predictions recorded yet — run tasks with prior runs of the same task to accumulate calibration');
    return lines.join('\n');
  }
  lines.push(`overall: ${report.hits}/${report.shadowed} hits (${(report.hitRate * 100).toFixed(1)}%)`);
  for (const [source, row] of Object.entries(report.bySource).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${source}: ${row.hits}/${row.steps}`);
  }
  lines.push('calibration (confidence bucket → realized hit rate):');
  for (const bucket of report.calibration.filter((entry) => entry.steps > 0)) {
    lines.push(`  ${bucket.bucket}: ${(bucket.hit_rate * 100).toFixed(1)}% over ${bucket.steps} steps (mean confidence ${bucket.mean_confidence.toFixed(2)})`);
  }
  lines.push('acting thresholds (coverage / precision):');
  for (const row of report.thresholds) {
    lines.push(`  ≥${row.threshold}: ${(row.coverage * 100).toFixed(1)}% coverage, ${(row.precision * 100).toFixed(1)}% precision (${row.hits}/${row.acted})`);
  }
  return lines.join('\n');
}
