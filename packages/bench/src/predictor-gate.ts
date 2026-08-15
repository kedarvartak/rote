import { z } from 'zod';
import { defaultTaskKey, predictTrace, sameAction, type ActionKey, type RecordedRun, type TracePrediction } from '@rote/predictor';

// see docs/05-roadmap.md P2 item 10 — the predictor kill gate. "≥70% warm
// next-action accuracy on recorded runs, or P3's speculation thesis dies early."
// This is a measurement, not a system: a deterministic trace-matching predictor
// over already-recorded runs, evaluated leave-one-run-out per task. Everything
// here is pure; the data files are the ones the T-series already froze.

export { type ActionKey, type RecordedRun, defaultTaskKey, runsFromEvents, runsFromJsonl, actionKeyFromEvent as actionKey, sameAction } from '@rote/predictor';

/** Trace-matching prediction: longest matching history suffix across prior runs of the same task, majority vote on ties. */
export type Prediction = Pick<TracePrediction, 'predicted' | 'matchedLength' | 'votes'>;

export const PredictorGateSummarySchema = z.object({
  schema_version: z.literal(1),
  predictor: z.literal('trace-matching-v0'),
  threshold: z.number(),
  data_sets: z.array(z.object({
    id: z.string(),
    /** `kind_target` = full trajectories; `kind_only` = curve records that recorded only the action kind. */
    granularity: z.enum(['kind_target', 'kind_only']),
    runs: z.number().int(),
    tasks: z.number().int(),
    predicted_steps: z.number().int(),
    kind_target_correct: z.number().int(),
    kind_only_correct: z.number().int(),
    kind_target_accuracy: z.number(),
    kind_only_accuracy: z.number(),
    wilson_95: z.tuple([z.number(), z.number()]),
    per_task: z.array(z.object({ task: z.string(), runs: z.number().int(), steps: z.number().int(), accuracy: z.number() })),
  })),
  /** Aggregate over `kind_target` data sets only — the gate is about the whole action, not its verb. */
  aggregate: z.object({
    predicted_steps: z.number().int(),
    kind_target_accuracy: z.number(),
    wilson_95: z.tuple([z.number(), z.number()]),
    verdict: z.enum(['pass', 'kill']),
    /** True when the lower 95% bound also clears the threshold; reported, not required. */
    lower_bound_clears: z.boolean(),
  }),
});
export type PredictorGateSummary = z.infer<typeof PredictorGateSummarySchema>;

const CurveRecordSchema = z.object({
  run_id: z.string().min(1),
  agent_step_index: z.number().int().nonnegative(),
  action_kind: z.string().min(1),
  action_target: z.string().optional(),
  record_kind: z.string().optional(),
}).passthrough();

/**
 * Parses G1 curve measurement records (`*-rote.jsonl`). Runs recorded before the
 * T38 condition carry only the action kind (target ''); runs recorded with
 * `action_target` carry the value-free target and evaluate as `kind_target`
 * (see `curveRunsGranularity`). One provider call may span several records of
 * the same agent step (repairs); the step's action is recorded once.
 */
export function runsFromCurveRecords(text: string, taskKey: (runId: string) => string = defaultTaskKey): RecordedRun[] {
  const byRun = new Map<string, Map<number, ActionKey>>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const parsed = CurveRecordSchema.safeParse(JSON.parse(line));
    if (!parsed.success || (parsed.data.record_kind !== undefined && parsed.data.record_kind !== 'measurement')) continue;
    const steps = byRun.get(parsed.data.run_id) ?? new Map<number, ActionKey>();
    steps.set(parsed.data.agent_step_index, { kind: parsed.data.action_kind, target: parsed.data.action_target ?? '' });
    byRun.set(parsed.data.run_id, steps);
  }
  return [...byRun.entries()].map(([runId, steps]) => ({
    runId,
    taskKey: taskKey(runId),
    actions: [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([, action]) => action),
  }));
}

/**
 * `kind_target` when every recorded step that has a target to record (anything
 * but `done`) carries one; otherwise the data set can only be scored by verb.
 */
export function curveRunsGranularity(runs: readonly RecordedRun[]): DataSetEvaluation['granularity'] {
  const targeted = runs.flatMap((run) => run.actions).filter((action) => action.kind !== 'done');
  return targeted.length > 0 && targeted.every((action) => action.target !== '') ? 'kind_target' : 'kind_only';
}

/** The kill-gate predictor (T38): longest matching history suffix, majority vote, bigram then first-action fallback. */
export function predictNext(history: readonly ActionKey[], priors: readonly RecordedRun[]): Prediction {
  const trace = predictTrace(history, priors);
  return { predicted: trace.predicted, matchedLength: trace.matchedLength, votes: trace.votes };
}

export interface DataSetEvaluation {
  id: string;
  granularity: 'kind_target' | 'kind_only';
  runs: number;
  tasks: number;
  predictedSteps: number;
  kindTargetCorrect: number;
  kindOnlyCorrect: number;
  perTask: Array<{ task: string; runs: number; steps: number; accuracy: number }>;
}

/** Leave-one-run-out warm evaluation: every step of every run predicted from the other runs of its task. */
export function evaluateDataSet(id: string, runs: readonly RecordedRun[], granularity: DataSetEvaluation['granularity'] = 'kind_target'): DataSetEvaluation {
  const byTask = new Map<string, RecordedRun[]>();
  for (const run of runs) byTask.set(run.taskKey, [...(byTask.get(run.taskKey) ?? []), run]);
  let predictedSteps = 0;
  let kindTargetCorrect = 0;
  let kindOnlyCorrect = 0;
  const perTask: DataSetEvaluation['perTask'] = [];
  for (const [task, taskRuns] of byTask) {
    if (taskRuns.length < 2) continue; // no warm prior — cold, not measured
    let steps = 0;
    let correct = 0;
    for (const run of taskRuns) {
      const priors = taskRuns.filter((candidate) => candidate.runId !== run.runId);
      for (let index = 0; index < run.actions.length; index += 1) {
        const prediction = predictNext(run.actions.slice(0, index), priors);
        const actual = run.actions[index]!;
        steps += 1;
        if (sameAction(prediction.predicted, actual)) correct += 1;
        if (prediction.predicted?.kind === actual.kind) kindOnlyCorrect += 1;
      }
    }
    predictedSteps += steps;
    kindTargetCorrect += correct;
    perTask.push({ task, runs: taskRuns.length, steps, accuracy: steps === 0 ? 0 : correct / steps });
  }
  return { id, granularity, runs: runs.length, tasks: byTask.size, predictedSteps, kindTargetCorrect, kindOnlyCorrect, perTask };
}

/** Wilson 95% interval for a proportion. */
export function wilson95(successes: number, trials: number): [number, number] {
  if (trials === 0) return [0, 0];
  const z = 1.959964;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return [Math.max(0, (centre - margin) / denominator), Math.min(1, (centre + margin) / denominator)];
}

/** Aggregates data-set evaluations into the kill-gate verdict at `threshold` (default 0.70). */
export function summarizePredictorGate(evaluations: readonly DataSetEvaluation[], threshold = 0.7): PredictorGateSummary {
  const gated = evaluations.filter((entry) => entry.granularity === 'kind_target');
  const steps = gated.reduce((sum, entry) => sum + entry.predictedSteps, 0);
  const correct = gated.reduce((sum, entry) => sum + entry.kindTargetCorrect, 0);
  const accuracy = steps === 0 ? 0 : correct / steps;
  const interval = wilson95(correct, steps);
  return PredictorGateSummarySchema.parse({
    schema_version: 1,
    predictor: 'trace-matching-v0',
    threshold,
    data_sets: evaluations.map((entry) => ({
      id: entry.id,
      granularity: entry.granularity,
      runs: entry.runs,
      tasks: entry.tasks,
      predicted_steps: entry.predictedSteps,
      kind_target_correct: entry.kindTargetCorrect,
      kind_only_correct: entry.kindOnlyCorrect,
      kind_target_accuracy: entry.predictedSteps === 0 ? 0 : entry.kindTargetCorrect / entry.predictedSteps,
      kind_only_accuracy: entry.predictedSteps === 0 ? 0 : entry.kindOnlyCorrect / entry.predictedSteps,
      wilson_95: wilson95(entry.kindTargetCorrect, entry.predictedSteps),
      per_task: entry.perTask,
    })),
    aggregate: {
      predicted_steps: steps,
      kind_target_accuracy: accuracy,
      wilson_95: interval,
      verdict: accuracy >= threshold ? 'pass' : 'kill',
      lower_bound_clears: interval[0] >= threshold,
    },
  });
}
