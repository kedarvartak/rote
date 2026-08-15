import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { curveRunsGranularity, evaluateDataSet, predictNext, PredictorGateSummarySchema, runsFromCurveRecords, runsFromJsonl, summarizePredictorGate, wilson95, type RecordedRun } from '../src/predictor-gate.js';

// see docs/05-roadmap.md P2 item 10 — the predictor kill gate is a measurement over
// frozen recorded runs. The stored T38 summary is recomputed here so the doc cannot
// drift from the data or the predictor.

const dataDir = resolve('../../docs/testing/data');
export const TRAJECTORY_SETS = ['T13-g2-rote-trajectories.jsonl', 'T20-b2-exact-rote-trajectories.jsonl', 'T21-b5-drift-trajectories.jsonl', 'T25-browser-use-0137-certification-rote-trajectories.jsonl', 'T26-post-action-evidence-trajectories.jsonl'];
export const CURVE_SETS = ['T10-v8-certification-rote.jsonl', 'T11-cache-key-v1-rote.jsonl', 'T9-v8-tag-qualification-rote.jsonl'];

function run(runId: string, taskKey: string, keys: Array<[string, string]>): RecordedRun {
  return { runId, taskKey, actions: keys.map(([kind, target]) => ({ kind, target })) };
}

describe('trace-matching predictor', () => {
  const priors = [
    run('t-r01', 't', [['navigate', '/login'], ['fill', 'user'], ['fill', 'pass'], ['click', 'submit'], ['done', '']]),
    run('t-r02', 't', [['navigate', '/login'], ['fill', 'user'], ['fill', 'pass'], ['click', 'submit'], ['done', '']]),
    run('t-r03', 't', [['navigate', '/login'], ['fill', 'user'], ['click', 'submit'], ['fill', 'pass'], ['click', 'submit'], ['done', '']]),
  ];

  it('predicts by the longest matching history suffix and votes on ties', () => {
    expect(predictNext([], priors)).toMatchObject({ predicted: { kind: 'navigate', target: '/login' }, matchedLength: 0, votes: 3 });
    expect(predictNext([{ kind: 'navigate', target: '/login' }, { kind: 'fill', target: 'user' }], priors)).toMatchObject({ predicted: { kind: 'fill', target: 'pass' }, matchedLength: 2, votes: 2 });
    // After the retry-shaped prefix only r03 matches at length 4.
    expect(predictNext([{ kind: 'navigate', target: '/login' }, { kind: 'fill', target: 'user' }, { kind: 'click', target: 'submit' }, { kind: 'fill', target: 'pass' }], priors)).toMatchObject({ predicted: { kind: 'click', target: 'submit' }, matchedLength: 4, votes: 1 });
    // A partially unknown history still matches on its known suffix.
    expect(predictNext([{ kind: 'hover', target: 'x' }, { kind: 'fill', target: 'pass' }], priors)).toMatchObject({ predicted: { kind: 'click', target: 'submit' }, matchedLength: 1 });
    // A wholly unknown history falls back to the majority first action, honestly marked as no match.
    expect(predictNext([{ kind: 'hover', target: 'x' }], priors)).toMatchObject({ predicted: { kind: 'navigate', target: '/login' }, matchedLength: 0 });
  });

  it('evaluates leave-one-run-out per task and never scores a task with a single run', () => {
    const evaluation = evaluateDataSet('synthetic', [...priors, run('u-r01', 'u', [['done', '']])]);
    expect(evaluation.tasks).toBe(2);
    expect(evaluation.predictedSteps).toBe(16);
    expect(evaluation.perTask).toEqual([{ task: 't', runs: 3, steps: 16, accuracy: expect.any(Number) }]);
    expect(evaluation.kindTargetCorrect).toBeLessThanOrEqual(evaluation.kindOnlyCorrect);
  });

  it('kills below the threshold and passes at or above it, with a Wilson interval', () => {
    const weak = { id: 'weak', granularity: 'kind_target' as const, runs: 2, tasks: 1, predictedSteps: 100, kindTargetCorrect: 60, kindOnlyCorrect: 90, perTask: [] };
    const strong = { ...weak, id: 'strong', kindTargetCorrect: 80 };
    expect(summarizePredictorGate([weak]).aggregate.verdict).toBe('kill');
    expect(summarizePredictorGate([strong]).aggregate).toMatchObject({ verdict: 'pass', lower_bound_clears: true });
    // Kind-only sets are reported but never aggregated into the gate.
    expect(summarizePredictorGate([{ ...strong, granularity: 'kind_only' }]).aggregate.predicted_steps).toBe(0);
    expect(wilson95(80, 100)[0]).toBeGreaterThan(0.7);
    expect(wilson95(0, 0)).toEqual([0, 0]);
  });

  it('recomputes the stored T38 summary from the frozen data sets', () => {
    const evaluations = [
      ...TRAJECTORY_SETS.map((id) => evaluateDataSet(id, runsFromJsonl(readFileSync(resolve(dataDir, id), 'utf8')))),
      ...CURVE_SETS.map((id) => { const runs = runsFromCurveRecords(readFileSync(resolve(dataDir, id), 'utf8')); return evaluateDataSet(id, runs, curveRunsGranularity(runs)); }),
    ];
    const summary = summarizePredictorGate(evaluations);
    const stored = PredictorGateSummarySchema.parse(JSON.parse(readFileSync(resolve(dataDir, 'T38-predictor-gate-summary.json'), 'utf8')));
    expect(summary).toEqual(stored);
    expect(summary.aggregate.verdict).toBe('pass');
    expect(summary.aggregate.predicted_steps).toBeGreaterThan(1_000);
  });

  it('scores curve records with action targets as kind_target and never counts a repair call as a second step', () => {
    const record = (run: string, step: number, kind: string, target: string | undefined, source = 'planner') => JSON.stringify({ record_kind: 'measurement', run_id: run, agent_step_index: step, action_kind: kind, ...(target === undefined ? {} : { action_target: target }), source });
    const targeted = [
      record('t-r01', 1, 'fill', 'v2:aaaaaaaaaaaaaaaa'), record('t-r01', 1, 'fill', 'v2:aaaaaaaaaaaaaaaa', 'repair'), record('t-r01', 2, 'click', 'v2:bbbbbbbbbbbbbbbb'), record('t-r01', 3, 'done', ''),
      record('t-r02', 1, 'fill', 'v2:aaaaaaaaaaaaaaaa'), record('t-r02', 2, 'click', 'v2:cccccccccccccccc'), record('t-r02', 3, 'done', ''),
    ].join('\n');
    const runs = runsFromCurveRecords(targeted);
    expect(runs.map((run) => run.actions.length)).toEqual([3, 3]);
    expect(curveRunsGranularity(runs)).toBe('kind_target');
    const evaluation = evaluateDataSet('targeted', runs, curveRunsGranularity(runs));
    // Six agent steps, not seven: the repair call is the same step. Step 1 predicts
    // exactly, step 2's target differs between runs, and step 3 loses its history
    // suffix after the differing click and falls back to the first-action vote.
    expect(evaluation).toMatchObject({ predictedSteps: 6, kindOnlyCorrect: 4, kindTargetCorrect: 2 });
    // Legacy records (no action_target) can only be scored by verb.
    const legacy = [record('l-r01', 1, 'fill', undefined), record('l-r01', 2, 'done', undefined), record('l-r02', 1, 'fill', undefined), record('l-r02', 2, 'done', undefined)].join('\n');
    expect(curveRunsGranularity(runsFromCurveRecords(legacy))).toBe('kind_only');
  });
});
