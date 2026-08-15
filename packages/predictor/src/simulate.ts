import { z } from 'zod';
import type { RecordedRun } from './corpus.js';
import { groupRunsByTask, isHit, NextActionPredictor, type NextActionPredictorOptions } from './ensemble.js';

// Offline simulation: leave-one-run-out per task, every step predicted from the
// task's other runs, recording confidence and hit. The outputs are what P3 needs
// before it may speculate: a calibration table (does 0.9 mean ~90%?) and the
// coverage/precision trade-off at candidate thresholds.

export const PredictorSimulationSummarySchema = z.object({
  schema_version: z.literal(1),
  predictor: z.literal('ensemble-v1'),
  runs: z.number().int(),
  tasks: z.number().int(),
  predicted_steps: z.number().int(),
  hits: z.number().int(),
  hit_rate: z.number(),
  by_source: z.array(z.object({ source: z.string(), steps: z.number().int(), hits: z.number().int(), hit_rate: z.number() })),
  /** Calibration: predicted-confidence bucket → observed hit rate. */
  calibration: z.array(z.object({ bucket: z.string(), lower: z.number(), upper: z.number(), steps: z.number().int(), hits: z.number().int(), hit_rate: z.number(), mean_confidence: z.number() })),
  /** At each threshold: fraction of steps that would be acted on, and how often those were right. */
  thresholds: z.array(z.object({ threshold: z.number(), coverage: z.number(), precision: z.number(), acted: z.number().int(), hits: z.number().int() })),
});
export type PredictorSimulationSummary = z.infer<typeof PredictorSimulationSummarySchema>;

export interface SimulateOptions extends NextActionPredictorOptions {
  thresholds?: readonly number[];
  buckets?: number;
}

const DEFAULT_THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95];

/** Leave-one-run-out simulation over a corpus; tasks with a single run are cold and skipped. */
export function simulatePredictor(runs: readonly RecordedRun[], options: SimulateOptions = {}): PredictorSimulationSummary {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const bucketCount = options.buckets ?? 5;
  const byTask = groupRunsByTask(runs);
  const samples: Array<{ confidence: number; hit: boolean; source: string }> = [];
  let tasks = 0;
  for (const [, taskRuns] of byTask) {
    if (taskRuns.length < 2) continue;
    tasks += 1;
    for (const run of taskRuns) {
      const predictor = new NextActionPredictor(taskRuns.filter((candidate) => candidate.runId !== run.runId), options);
      for (let index = 0; index < run.actions.length; index += 1) {
        const prediction = predictor.predict(run.actions.slice(0, index));
        samples.push({ confidence: prediction.confidence, hit: isHit(prediction, run.actions[index]!), source: prediction.source });
      }
    }
  }
  const hits = samples.filter((sample) => sample.hit).length;
  const sources = [...new Set(samples.map((sample) => sample.source))].sort();
  const calibration = Array.from({ length: bucketCount }, (_, index) => {
    const lower = index / bucketCount;
    const upper = (index + 1) / bucketCount;
    const inBucket = samples.filter((sample) => sample.confidence >= lower && (index === bucketCount - 1 ? sample.confidence <= upper : sample.confidence < upper));
    const bucketHits = inBucket.filter((sample) => sample.hit).length;
    return {
      bucket: `${lower.toFixed(1)}–${upper.toFixed(1)}`, lower, upper, steps: inBucket.length, hits: bucketHits,
      hit_rate: inBucket.length === 0 ? 0 : bucketHits / inBucket.length,
      mean_confidence: inBucket.length === 0 ? 0 : inBucket.reduce((sum, sample) => sum + sample.confidence, 0) / inBucket.length,
    };
  });
  return PredictorSimulationSummarySchema.parse({
    schema_version: 1,
    predictor: 'ensemble-v1',
    runs: runs.length,
    tasks,
    predicted_steps: samples.length,
    hits,
    hit_rate: samples.length === 0 ? 0 : hits / samples.length,
    by_source: sources.map((source) => {
      const subset = samples.filter((sample) => sample.source === source);
      const subsetHits = subset.filter((sample) => sample.hit).length;
      return { source, steps: subset.length, hits: subsetHits, hit_rate: subset.length === 0 ? 0 : subsetHits / subset.length };
    }),
    calibration,
    thresholds: thresholds.map((threshold) => {
      const acted = samples.filter((sample) => sample.confidence >= threshold);
      const actedHits = acted.filter((sample) => sample.hit).length;
      return { threshold, coverage: samples.length === 0 ? 0 : acted.length / samples.length, precision: acted.length === 0 ? 0 : actedHits / acted.length, acted: acted.length, hits: actedHits };
    }),
  });
}
