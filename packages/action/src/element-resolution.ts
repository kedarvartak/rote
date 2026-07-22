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

/** Raised when independently grounded semantic hints identify different elements. */
export class ElementResolutionConflictError extends ElementResolutionError {
  constructor(
    target: ElementResolutionTarget,
    readonly stableSelector: string,
    readonly semanticSelector: string,
  ) {
    super(target);
    this.name = 'ElementResolutionConflictError';
    this.message = `conflicting browser target identity: stableId resolves ${stableSelector}, role+name resolves ${semanticSelector}`;
  }
}

/** Resolves stable ID → role+name → text proximity → supplied selector. */
export function resolveElementTarget(
  nodes: readonly DistilledNode[],
  target: ElementResolutionTarget,
): ElementResolutionResult {
  const stableMatches = target.stableId
    ? nodes.filter((candidate) => candidate.id.hash === target.stableId && candidate.selectorHint)
    : [];
  const role = target.role ? normalize(target.role) : undefined;
  const name = target.name ? normalize(target.name) : undefined;
  const semanticMatches = role && name
    ? nodes.filter((candidate) => (
      normalize(candidate.role) === role && normalize(candidate.name) === name && candidate.selectorHint
    ))
    : [];

  // INVARIANT: two independently grounded semantic identities may not be mixed.
  // A selector can legitimately drift, but a stable ID for one element plus the
  // exact role/name of another is evidence of planner field splicing, not healing.
  if (stableMatches.length === 1 && semanticMatches.length === 1 && stableMatches[0] !== semanticMatches[0]) {
    throw new ElementResolutionConflictError(
      target,
      stableMatches[0]!.selectorHint!,
      semanticMatches[0]!.selectorHint!,
    );
  }
  if (stableMatches.length === 1) return result(stableMatches[0]!, 'stable-id');
  if (semanticMatches.length === 1) return result(semanticMatches[0]!, 'role-name');

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
