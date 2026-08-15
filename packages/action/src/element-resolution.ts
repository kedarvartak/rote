import type { BrowserContextCoordinate } from '@rote/browser';
import { stableNodeRef, type DistilledNode } from '@rote/perception';

export interface ElementResolutionTarget {
  selector: string;
  stableId?: string;
  role?: string;
  name?: string;
  text?: string;
  contextHash?: string;
}

export type ElementResolutionStrategy = 'stable-id' | 'role-name' | 'text-proximity' | 'selector';

export interface ElementResolutionResult {
  selector: string;
  strategy: ElementResolutionStrategy;
  stableId?: string;
  context?: BrowserContextCoordinate;
}

/** Raised when no actionable selector can be resolved through the fallback chain. */
export class ElementResolutionError extends Error {
  constructor(readonly target: ElementResolutionTarget) {
    super(`could not resolve browser target: ${JSON.stringify(target)}`);
    this.name = 'ElementResolutionError';
  }
}

/** Raised when a target's durable browsing context is absent from the live capture. */
export class ElementResolutionContextMismatchError extends ElementResolutionError {
  constructor(target: ElementResolutionTarget, readonly contextHash: string) {
    super(target);
    this.name = 'ElementResolutionContextMismatchError';
    this.message = `browser target context mismatch: ${contextHash}`;
  }
}

/** Raised when more than one live element retains the requested semantic identity. */
export class ElementResolutionAmbiguityError extends ElementResolutionError {
  constructor(target: ElementResolutionTarget, readonly candidateCount: number) {
    super(target);
    this.name = 'ElementResolutionAmbiguityError';
    this.message = `ambiguous browser target identity: ${candidateCount} candidates`;
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

/**
 * Raised when an action re-issues a stable identity that an earlier dispatch already
 * consumed and that no longer exists in the live capture. On a remounting or
 * virtualized SPA the fuzzy chain would otherwise heal "the button I already
 * clicked" onto its similarly named successor — a dispatch the planner never
 * chose (#132). Rename drift of a never-dispatched identity is unaffected.
 */
export class ElementResolutionStaleIdentityError extends ElementResolutionError {
  constructor(target: ElementResolutionTarget, readonly resolvedSelector: string, readonly resolvedStableId?: string) {
    super(target);
    this.name = 'ElementResolutionStaleIdentityError';
    this.message = `stale browser target identity: ${target.stableId} was already dispatched, is absent from the current observation, and would rebind to ${resolvedSelector}${resolvedStableId ? ` (${resolvedStableId})` : ''}`;
  }
}

/** Resolves stable ID → role+name → text proximity → supplied selector. */
export function resolveElementTarget(
  nodes: readonly DistilledNode[],
  target: ElementResolutionTarget,
): ElementResolutionResult {
  const contextNodes = target.contextHash
    ? nodes.filter((candidate) => 'version' in candidate.id && candidate.id.contextHash === target.contextHash)
    : nodes;
  // INVARIANT: context mismatch short-circuits before semantic/fuzzy matching.
  if (target.contextHash && contextNodes.length === 0) {
    throw new ElementResolutionContextMismatchError(target, target.contextHash);
  }
  const stableMatchesOutsideContext = target.stableId && target.contextHash
    ? nodes.filter((candidate) => stableNodeRef(candidate.id) === target.stableId
      && 'version' in candidate.id && candidate.id.contextHash !== target.contextHash)
    : [];
  if (stableMatchesOutsideContext.length) {
    throw new ElementResolutionContextMismatchError(target, target.contextHash!);
  }
  const stableMatches = target.stableId
    ? contextNodes.filter((candidate) => stableNodeRef(candidate.id) === target.stableId && candidate.selectorHint)
    : [];
  const role = target.role ? normalize(target.role) : undefined;
  const name = target.name ? normalize(target.name) : undefined;
  const semanticMatches = role && name
    ? contextNodes.filter((candidate) => (
      normalize(candidate.role) === role && normalize(candidate.name) === name && candidate.selectorHint
    ))
    : [];

  // INVARIANT: residual v2 collisions stop before text/selector fallback. Choosing
  // the first repeated control would turn identity uncertainty into a dispatch.
  if (stableMatches.length > 1) throw new ElementResolutionAmbiguityError(target, stableMatches.length);
  if (stableMatches.length === 0 && semanticMatches.length > 1) {
    throw new ElementResolutionAmbiguityError(target, semanticMatches.length);
  }

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
    const ranked = contextNodes
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
    : contextNodes.filter((candidate) => candidate.selectorHint === target.selector);
  if (selectorMatches.length === 1) return result(selectorMatches[0]!, 'selector');

  const hasSemanticIdentity = Boolean(target.stableId || target.role || target.name || target.text);
  if (!hasSemanticIdentity && target.selector.trim()) return { selector: target.selector, strategy: 'selector' };
  throw new ElementResolutionError(target);
}

function result(node: DistilledNode, strategy: ElementResolutionStrategy): ElementResolutionResult {
  return {
    selector: node.selectorHint!,
    strategy,
    stableId: stableNodeRef(node.id),
    ...(node.context ? { context: node.context } : {}),
  };
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
