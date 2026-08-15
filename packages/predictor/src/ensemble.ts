import { actionKeyId, sameAction, type ActionKey } from './action-key.js';
import type { RecordedRun } from './corpus.js';
import { predictTrace, type RankedCandidate } from './trace-predictor.js';
import { buildTransitionModel, predictTransition, type TransitionModel } from './transition-predictor.js';

// The runtime component: a per-task predictor with an explainable confidence.
// Confidence is *not* a probability claim — it is a monotone score whose
// calibration is measured offline (`simulatePredictor`) so speculation (P3) can
// pick a threshold from data. Nothing here dispatches; a prediction is advice.

export interface NextActionPrediction {
  predicted: ActionKey | undefined;
  /** Monotone score in [0, 1]; calibrate before using as a probability. */
  confidence: number;
  source: 'trace' | 'transition' | 'first_action' | 'none';
  /** How many history actions the winning trace match spanned (0 for non-trace sources). */
  matchedLength: number;
  candidates: RankedCandidate[];
}

export interface NextActionPredictorOptions {
  /** Trace matches this long or longer get full weight; shorter matches are discounted linearly. */
  fullConfidenceMatchLength?: number;
}

/** Predicts the next action for one task from that task's prior runs. Pure; built once, queried per step. */
export class NextActionPredictor {
  private readonly model: TransitionModel;
  private readonly fullLength: number;

  constructor(private readonly priors: readonly RecordedRun[], options: NextActionPredictorOptions = {}) {
    this.model = buildTransitionModel(priors);
    this.fullLength = options.fullConfidenceMatchLength ?? 3;
  }

  get priorCount(): number { return this.priors.length; }

  predict(history: readonly ActionKey[]): NextActionPrediction {
    if (this.priors.length === 0) return { predicted: undefined, confidence: 0, source: 'none', matchedLength: 0, candidates: [] };
    const trace = predictTrace(history, this.priors);
    if (trace.fallback === 'none' && trace.predicted) {
      // Agreement among the longest matches, discounted for short matches; a lone
      // prior run agreeing with itself is capped below certainty.
      const lengthFactor = Math.min(1, (trace.matchedLength + (history.length === 0 ? 1 : 0)) / this.fullLength);
      const support = Math.min(1, trace.votes / Math.max(2, Math.min(this.priors.length, 3)));
      return { predicted: trace.predicted, confidence: round(trace.candidates[0]!.share * lengthFactor * (0.5 + 0.5 * support)), source: 'trace', matchedLength: trace.matchedLength, candidates: trace.candidates };
    }
    const transition = predictTransition(history, this.model);
    if (transition.candidates.length > 0) {
      const top = transition.candidates[0]!;
      // Position-blind evidence is weaker than a suffix match by construction.
      return { predicted: top.key, confidence: round(top.share * (transition.order === 3 ? 0.6 : 0.4)), source: 'transition', matchedLength: 0, candidates: transition.candidates };
    }
    if (trace.predicted) return { predicted: trace.predicted, confidence: round(trace.candidates[0]!.share * 0.25), source: 'first_action', matchedLength: 0, candidates: trace.candidates };
    return { predicted: undefined, confidence: 0, source: 'none', matchedLength: 0, candidates: [] };
  }
}

/** Groups a corpus by task key so per-task predictors can be built lazily. */
export function groupRunsByTask(runs: readonly RecordedRun[]): Map<string, RecordedRun[]> {
  const byTask = new Map<string, RecordedRun[]>();
  for (const run of runs) byTask.set(run.taskKey, [...(byTask.get(run.taskKey) ?? []), run]);
  return byTask;
}

export function isHit(prediction: NextActionPrediction, actual: ActionKey): boolean {
  return sameAction(prediction.predicted, actual);
}

export function candidateIds(candidates: readonly RankedCandidate[]): string[] {
  return candidates.map((candidate) => actionKeyId(candidate.key));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
