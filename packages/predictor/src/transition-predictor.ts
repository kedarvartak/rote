import { actionKeyId, type ActionKey } from './action-key.js';
import type { RecordedRun } from './corpus.js';
import type { RankedCandidate } from './trace-predictor.js';

// A smoothed n-gram transition model over action keys (order 2 with order-1
// backoff): what tends to follow the last one or two actions, independent of
// where in the run they occur. Cheaper and blunter than trace matching; the
// ensemble uses it when no suffix matches and to break trace ties.

const START = '<start>';

export interface TransitionModel {
  /** P(next | previous two) as counts, keyed `a|b`. */
  trigram: Map<string, Map<string, { key: ActionKey; count: number }>>;
  /** P(next | previous one) as counts. */
  bigram: Map<string, Map<string, { key: ActionKey; count: number }>>;
  vocabulary: number;
}

/** Counts transitions over the runs (position-independent). */
export function buildTransitionModel(runs: readonly RecordedRun[]): TransitionModel {
  const trigram = new Map<string, Map<string, { key: ActionKey; count: number }>>();
  const bigram = new Map<string, Map<string, { key: ActionKey; count: number }>>();
  const vocabulary = new Set<string>();
  const bump = (table: Map<string, Map<string, { key: ActionKey; count: number }>>, context: string, next: ActionKey) => {
    const row = table.get(context) ?? new Map<string, { key: ActionKey; count: number }>();
    const id = actionKeyId(next);
    const entry = row.get(id) ?? { key: next, count: 0 };
    entry.count += 1;
    row.set(id, entry);
    table.set(context, row);
  };
  for (const run of runs) {
    let previous = START;
    let previous2 = START;
    for (const action of run.actions) {
      const id = actionKeyId(action);
      vocabulary.add(id);
      bump(bigram, previous, action);
      bump(trigram, `${previous2}|${previous}`, action);
      previous2 = previous;
      previous = id;
    }
  }
  return { trigram, bigram, vocabulary: vocabulary.size };
}

/** Ranked next actions from the model with add-one smoothing; empty when the context was never seen. */
export function predictTransition(history: readonly ActionKey[], model: TransitionModel): { candidates: RankedCandidate[]; order: 3 | 2 | 0 } {
  const previous = history.length > 0 ? actionKeyId(history[history.length - 1]!) : START;
  const previous2 = history.length > 1 ? actionKeyId(history[history.length - 2]!) : START;
  const row = model.trigram.get(`${previous2}|${previous}`);
  if (row && row.size > 0) return { candidates: rank(row, model.vocabulary), order: 3 };
  const back = model.bigram.get(previous);
  if (back && back.size > 0) return { candidates: rank(back, model.vocabulary), order: 2 };
  return { candidates: [], order: 0 };
}

function rank(row: Map<string, { key: ActionKey; count: number }>, vocabulary: number): RankedCandidate[] {
  const total = [...row.values()].reduce((sum, entry) => sum + entry.count, 0);
  return [...row.values()]
    .sort((a, b) => b.count - a.count || actionKeyId(a.key).localeCompare(actionKeyId(b.key)))
    // Add-one smoothing keeps the shares honest on thin rows: one observation of one
    // successor is not certainty.
    .map((entry) => ({ key: entry.key, votes: entry.count, share: (entry.count + 1) / (total + Math.max(1, vocabulary)) }));
}
