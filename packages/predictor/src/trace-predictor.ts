import { actionKeyId, sameAction, type ActionKey } from './action-key.js';
import type { RecordedRun } from './corpus.js';

// see docs/testing/T38-predictor-kill-gate.md — the kill-gate predictor: longest
// matching history suffix across prior runs of the same task, majority vote on
// ties, bigram then first-action fallback. Sees only history; a predictor with
// the observation can only do better.

export interface RankedCandidate {
  key: ActionKey;
  votes: number;
  /** Share of the votes at the winning match length, in (0, 1]. */
  share: number;
}

export interface TracePrediction {
  predicted: ActionKey | undefined;
  /** How many history actions matched (0 = bigram / first-action fallback). */
  matchedLength: number;
  votes: number;
  candidates: RankedCandidate[];
  fallback: 'none' | 'bigram' | 'first_action';
}

/**
 * Predicts the next action after `history` from `priors` (other runs of the same
 * task): for every prior run and position, the longest suffix of `history` that
 * ends just before it; the longest matches vote for their following action.
 * With no positional match, fall back to the majority next action after the last
 * history key anywhere in priors (bigram), then to the majority first action.
 */
export function predictTrace(history: readonly ActionKey[], priors: readonly RecordedRun[]): TracePrediction {
  let best = 0;
  let votes = new Map<string, { key: ActionKey; count: number }>();
  const vote = (key: ActionKey) => {
    const id = actionKeyId(key);
    const entry = votes.get(id) ?? { key, count: 0 };
    entry.count += 1;
    votes.set(id, entry);
  };
  for (const prior of priors) {
    for (let position = 0; position < prior.actions.length; position += 1) {
      let length = 0;
      while (length < history.length && position - 1 - length >= 0
        && sameAction(prior.actions[position - 1 - length], history[history.length - 1 - length])) length += 1;
      // No history: only a run's first action is a candidate. With history, a
      // position that shares no suffix at all is not a match.
      if (history.length === 0 ? position !== 0 : length === 0) continue;
      if (length > best) { best = length; votes = new Map(); }
      if (length === best) vote(prior.actions[position]!);
    }
  }
  let fallback: TracePrediction['fallback'] = 'none';
  if (votes.size === 0 && history.length > 0) {
    fallback = 'bigram';
    const last = history[history.length - 1]!;
    for (const prior of priors) {
      prior.actions.forEach((action, index) => {
        if (sameAction(action, last) && prior.actions[index + 1]) vote(prior.actions[index + 1]!);
      });
    }
  }
  if (votes.size === 0) {
    fallback = 'first_action';
    for (const prior of priors) if (prior.actions[0]) vote(prior.actions[0]);
  }
  const total = [...votes.values()].reduce((sum, entry) => sum + entry.count, 0);
  const candidates = [...votes.values()]
    .sort((a, b) => b.count - a.count || actionKeyId(a.key).localeCompare(actionKeyId(b.key)))
    .map((entry) => ({ key: entry.key, votes: entry.count, share: total === 0 ? 0 : entry.count / total }));
  const winner = candidates[0];
  return { predicted: winner?.key, matchedLength: best, votes: winner?.votes ?? 0, candidates, fallback: votes.size === 0 ? 'first_action' : fallback };
}
