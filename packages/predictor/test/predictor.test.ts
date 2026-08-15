import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { actionKeyOf, actionTarget, buildTransitionModel, NextActionPredictor, predictTrace, predictTransition, PredictorSimulationSummarySchema, runsFromJsonl, simulatePredictor, type ActionKey, type RecordedRun } from '../src/index.js';

const k = (kind: string, target = ''): ActionKey => ({ kind, target });
const run = (runId: string, taskKey: string, ...actions: ActionKey[]): RecordedRun => ({ runId, taskKey, actions });
const login = [k('navigate', '/login'), k('fill', 'v2:aaaaaaaaaaaaaaaa'), k('fill', 'v2:bbbbbbbbbbbbbbbb'), k('click', 'v2:cccccccccccccccc'), k('done')];

describe('action keys', () => {
  it('are value-free: stable id, else selector; URL path for navigate; nothing for done', () => {
    expect(actionTarget({ kind: 'fill', stableId: 'v2:aaaaaaaaaaaaaaaa', selector: '#u' })).toBe('v2:aaaaaaaaaaaaaaaa');
    expect(actionTarget({ kind: 'click', selector: 'button.save' })).toBe('button.save');
    expect(actionTarget({ kind: 'navigate', url: 'https://x.test/a/b?token=secret' })).toBe('/a/b');
    expect(actionKeyOf({ kind: 'done' })).toEqual({ kind: 'done', target: '' });
  });
});

describe('trace + transition predictors', () => {
  const priors = [run('t-r01', 't', ...login), run('t-r02', 't', ...login), run('t-r03', 't', k('navigate', '/login'), k('fill', 'v2:aaaaaaaaaaaaaaaa'), k('fill', 'v2:bbbbbbbbbbbbbbbb'), k('click', 'v2:dddddddddddddddd'), k('done'))];

  it('votes across the longest matching suffix and exposes ranked candidates with shares', () => {
    const trace = predictTrace(login.slice(0, 3), priors);
    expect(trace).toMatchObject({ predicted: k('click', 'v2:cccccccccccccccc'), matchedLength: 3, votes: 2, fallback: 'none' });
    expect(trace.candidates.map((candidate) => [candidate.key.target, candidate.votes, candidate.share])).toEqual([['v2:cccccccccccccccc', 2, 2 / 3], ['v2:dddddddddddddddd', 1, 1 / 3]]);
    // Empty history: first actions only. Unknown last action: bigram, then first-action fallback.
    expect(predictTrace([], priors)).toMatchObject({ predicted: k('navigate', '/login'), matchedLength: 0, votes: 3, fallback: 'none' });
    expect(predictTrace([k('hover', 'v2:eeeeeeeeeeeeeeee')], priors)).toMatchObject({ predicted: k('navigate', '/login'), fallback: 'first_action' });
    expect(predictTrace([k('hover', 'x'), k('fill', 'v2:aaaaaaaaaaaaaaaa')], priors)).toMatchObject({ predicted: k('fill', 'v2:bbbbbbbbbbbbbbbb'), matchedLength: 1 });
  });

  it('backs off from trigram to bigram to nothing, with smoothed shares below certainty', () => {
    const model = buildTransitionModel(priors);
    const tri = predictTransition(login.slice(0, 3), model);
    expect(tri.order).toBe(3);
    expect(tri.candidates[0]!.key).toEqual(k('click', 'v2:cccccccccccccccc'));
    expect(tri.candidates[0]!.share).toBeLessThan(1);
    expect(predictTransition([k('hover', 'x'), k('fill', 'v2:bbbbbbbbbbbbbbbb')], model)).toMatchObject({ order: 2 });
    expect(predictTransition([k('hover', 'x')], model)).toEqual({ candidates: [], order: 0 });
  });

  it('ensembles trace first, transition second, first-action last, with monotone confidence and no dispatch', () => {
    const predictor = new NextActionPredictor(priors);
    const strong = predictor.predict(login.slice(0, 3));
    expect(strong).toMatchObject({ predicted: k('click', 'v2:cccccccccccccccc'), source: 'trace', matchedLength: 3 });
    const weak = predictor.predict([k('hover', 'x'), k('fill', 'v2:aaaaaaaaaaaaaaaa')]);
    expect(weak.source).toBe('trace');
    expect(weak.confidence).toBeLessThan(strong.confidence);
    // Reorder so no suffix matches but the last pair was seen: transition source.
    const shuffled = predictor.predict([k('fill', 'v2:bbbbbbbbbbbbbbbb'), k('fill', 'v2:aaaaaaaaaaaaaaaa'), k('fill', 'v2:bbbbbbbbbbbbbbbb')]);
    expect(['trace', 'transition']).toContain(shuffled.source);
    expect(new NextActionPredictor([]).predict([])).toEqual({ predicted: undefined, confidence: 0, source: 'none', matchedLength: 0, candidates: [] });
    expect(predictor.predict([k('hover', 'x')])).toMatchObject({ source: 'first_action', predicted: k('navigate', '/login') });
    fc.assert(fc.property(fc.array(fc.constantFrom(...login), { maxLength: 6 }), (history) => {
      const prediction = predictor.predict(history);
      return prediction.confidence >= 0 && prediction.confidence <= 1;
    }));
  });
});

describe('offline simulation', () => {
  it('reports hit rate, per-source rates, a calibration table, and coverage/precision at thresholds', () => {
    const runs = [run('a-r01', 'a', ...login), run('a-r02', 'a', ...login), run('a-r03', 'a', ...login), run('b-r01', 'b', k('navigate', '/x'), k('done')), run('c-r01', 'c', k('done'))];
    const summary = simulatePredictor(runs);
    PredictorSimulationSummarySchema.parse(summary);
    expect(summary).toMatchObject({ runs: 5, tasks: 1, predicted_steps: 15 });
    expect(summary.hit_rate).toBe(1);
    expect(summary.thresholds.map((entry) => entry.threshold)).toEqual([0.5, 0.7, 0.8, 0.9, 0.95]);
    for (const entry of summary.thresholds) expect(entry.coverage).toBeGreaterThanOrEqual(0);
    expect(summary.calibration.reduce((sum, bucket) => sum + bucket.steps, 0)).toBe(15);
    expect(summary.calibration.every((bucket) => bucket.steps === 0 || (bucket.mean_confidence >= bucket.lower && bucket.mean_confidence <= bucket.upper))).toBe(true);
  });

  it('recomputes the stored T39 simulation over the frozen kind+target data sets', () => {
    const dataDir = resolve('../../docs/testing/data');
    const sets = ['T13-g2-rote-trajectories.jsonl', 'T20-b2-exact-rote-trajectories.jsonl', 'T21-b5-drift-trajectories.jsonl', 'T25-browser-use-0137-certification-rote-trajectories.jsonl', 'T26-post-action-evidence-trajectories.jsonl'];
    const runs = sets.flatMap((id) => runsFromJsonl(readFileSync(resolve(dataDir, id), 'utf8'), (runId) => `${id}:${runId.replace(/-r\d+$/, '')}`));
    const summary = simulatePredictor(runs);
    const stored = PredictorSimulationSummarySchema.parse(JSON.parse(readFileSync(resolve(dataDir, 'T39-predictor-simulation.json'), 'utf8')));
    expect(summary).toEqual(stored);
    expect(summary.predicted_steps).toBe(1520);
    // Calibration is monotone-ish and the top bucket is where the mass sits: what P3 needs to pick a threshold.
    const high = summary.thresholds.find((entry) => entry.threshold === 0.9)!;
    expect(high.precision).toBeGreaterThan(0.95);
  });
});
