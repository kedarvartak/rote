import type { DistilledNode } from '@rote/perception';

export interface ElementResolutionTarget {
  selector: string;
  stableId?: string;
  role?: string;
  name?: string;
  text?: string;
}

export type ElementResolutionStrategy = 'stable-id' | 'role-name' | 'text-proximity' | 'selector';

export interface ElementResolutionResult {
  selector: string;
  strategy: ElementResolutionStrategy;
  stableId?: string;
}

/** Raised when no actionable selector can be resolved through the fallback chain. */
export class ElementResolutionError extends Error {
  constructor(readonly target: ElementResolutionTarget) {
    super(`could not resolve browser target: ${JSON.stringify(target)}`);
    this.name = 'ElementResolutionError';
  }
}

/** Resolves stable ID → role+name → text proximity → supplied selector. */
export function resolveElementTarget(
  nodes: readonly DistilledNode[],
  target: ElementResolutionTarget,
): ElementResolutionResult {
  if (target.stableId) {
    const matches = nodes.filter((candidate) => candidate.id.hash === target.stableId && candidate.selectorHint);
    if (matches.length === 1) return result(matches[0]!, 'stable-id');
  }

  if (target.role && target.name) {
    const role = normalize(target.role);
    const name = normalize(target.name);
    const matches = nodes.filter((candidate) => (
      normalize(candidate.role) === role && normalize(candidate.name) === name && candidate.selectorHint
    ));
    if (matches.length === 1) return result(matches[0]!, 'role-name');
  }

  const wantedText = target.text ?? target.name;
  if (wantedText) {
    const ranked = nodes
      .filter((candidate) => candidate.selectorHint)
      .map((candidate) => ({ candidate, score: textSimilarity(wantedText, candidate.name) }))
      .filter(({ score }) => score >= 0.5)
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (best?.candidate.selectorHint && (!runnerUp || best.score > runnerUp.score)) {
      return result(best.candidate, 'text-proximity');
    }
  }

  // A mismatched stable ID is stronger evidence of a stale/decoy selector and
  // must keep failing closed. Optional role/name hints are model-authored and
  // may be wrong even when the copied selector is uniquely present.
  const selectorMatches = target.stableId
    ? []
    : nodes.filter((candidate) => candidate.selectorHint === target.selector);
  if (selectorMatches.length === 1) return result(selectorMatches[0]!, 'selector');

  const hasSemanticIdentity = Boolean(target.stableId || target.role || target.name || target.text);
  if (!hasSemanticIdentity && target.selector.trim()) return { selector: target.selector, strategy: 'selector' };
  throw new ElementResolutionError(target);
}

function result(node: DistilledNode, strategy: ElementResolutionStrategy): ElementResolutionResult {
  return { selector: node.selectorHint!, strategy, stableId: node.id.hash };
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalize(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
