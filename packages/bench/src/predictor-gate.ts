import { z } from 'zod';
import { parseTrajectoryJsonl, type TrajectoryEvent } from '@rote/core';
import { curveActionTarget } from './curve-action-target.js';

// see docs/05-roadmap.md P2 item 10 — the predictor kill gate. "≥70% warm
// next-action accuracy on recorded runs, or P3's speculation thesis dies early."
// This is a measurement, not a system: a deterministic trace-matching predictor
// over already-recorded runs, evaluated leave-one-run-out per task. Everything
// here is pure; the data files are the ones the T-series already froze.

/** One recorded action reduced to what a predictor must get right: what to do and to which control. */
export interface ActionKey {
  kind: string;
  /** Stable identity when the recorder captured one, else the selector / URL path / '' for done. */
  target: string;
}

export interface RecordedRun {
  runId: string;
  taskKey: string;
  actions: ActionKey[];
}

/** Trace-matching prediction: longest matching history suffix across prior runs of the same task, majority vote on ties. */
export interface Prediction {
  predicted: ActionKey | undefined;
  /** How many history actions matched (0 = fell back to bigram / most common first action). */
  matchedLength: number;
  votes: number;
}

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

/** Task key = run id without its `-rNN` repetition suffix (how every T-series data set names runs). */
export function defaultTaskKey(runId: string): string {
  return runId.replace(/-r\d+$/, '');
}

/** Reduces trajectory events to per-run action keys; `done`/unknown tools keep kind only. */
export function runsFromEvents(events: readonly TrajectoryEvent[], taskKey: (runId: string) => string = defaultTaskKey): RecordedRun[] {
  const byRun = new Map<string, TrajectoryEvent[]>();
  for (const event of events) {
    const list = byRun.get(event.run_id) ?? [];
    list.push(event);
    byRun.set(event.run_id, list);
  }
  return [...byRun.entries()].map(([runId, list]) => ({
    runId,
    taskKey: taskKey(runId),
    actions: list.sort((a, b) => a.seq - b.seq).map((event) => actionKey(event)),
  }));
}

/** Parses one T-series trajectory JSONL data set into runs. */
export function runsFromJsonl(text: string, taskKey?: (runId: string) => string): RecordedRun[] {
  return runsFromEvents(parseTrajectoryJsonl(text), taskKey);
}

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

export function actionKey(event: TrajectoryEvent): ActionKey {
  const kind = event.tool.replace(/^browser\./, '');
  const args = event.args;
  const optional = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
  // Same derivation the curve runner records, so offline and live-recorded keys agree.
  return { kind, target: curveActionTarget({ kind, stableId: optional('stableId'), selector: optional('selector'), url: optional('url') }) };
}

export function sameAction(left: ActionKey | undefined, right: ActionKey): boolean {
  return left !== undefined && left.kind === right.kind && left.target === right.target;
}

/**
 * Predicts the next action after `history` from `priors` (other runs of the same
 * task): for every prior run and position, the longest suffix of `history` that
 * ends just before it; the longest matches vote for their following action. With
 * no positional match, fall back to the majority next action after the last
 * history key anywhere in priors (bigram), then to the majority first action.
 */
export function predictNext(history: readonly ActionKey[], priors: readonly RecordedRun[]): Prediction {
  let best = 0;
  const votes = new Map<string, { key: ActionKey; count: number }>();
  const vote = (key: ActionKey) => {
    const id = `${key.kind} ${key.target}`;
    const entry = votes.get(id) ?? { key, count: 0 };
    entry.count += 1;
    votes.set(id, entry);
  };
  for (const prior of priors) {
    for (let position = 0; position < prior.actions.length; position += 1) {
      let length = 0;
      while (length < history.length && position - 1 - length >= 0
        && sameAction(prior.actions[position - 1 - length], history[history.length - 1 - length]!)) length += 1;
      // No history: only a run's first action is a candidate. With history, a
      // position that shares no suffix at all is not a match.
      if (history.length === 0 ? position !== 0 : length === 0) continue;
      if (length > best) { best = length; votes.clear(); }
      if (length === best) vote(prior.actions[position]!);
    }
  }
  if (votes.size === 0 && history.length > 0) {
    const last = history[history.length - 1]!;
    for (const prior of priors) {
      prior.actions.forEach((action, index) => {
        if (sameAction(action, last) && prior.actions[index + 1]) vote(prior.actions[index + 1]!);
      });
    }
  }
  if (votes.size === 0) {
    for (const prior of priors) if (prior.actions[0]) vote(prior.actions[0]);
  }
  const winner = [...votes.values()].sort((a, b) => b.count - a.count || (a.key.kind + a.key.target).localeCompare(b.key.kind + b.key.target))[0];
  return { predicted: winner?.key, matchedLength: best, votes: winner?.count ?? 0 };
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
