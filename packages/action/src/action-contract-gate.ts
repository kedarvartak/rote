import { compareActionContracts, type ActionContract, type ActionContractComparison, type ActionContractEffect, type ActionContractMismatch, type ActionContractSafety, type ActionContractVerb } from '@rote/core';
import { stableNodeRef, type DistilledNode } from '@rote/perception';
import { classifyBrowserActionSafety } from './action-contract.js';

// see docs/02-architecture.md "Structural action-contract drift" (#143) — the
// gate compares the contract recorded with a step against the contract derived
// from the *current* capture of the resolved target, before anything dispatches.

/** Raised when a resolved target's live contract is incompatible with the recorded one; nothing was dispatched. */
export class ActionContractMismatchError extends Error {
  readonly classification = 'contract_mismatch' as const;
  readonly dispatched = false as const;
  constructor(readonly mismatches: readonly ActionContractMismatch[], readonly recorded: ActionContract, readonly current: ActionContract) {
    super(`action contract mismatch before dispatch: ${mismatches.map((entry) => `${entry.field} ${entry.recorded} → ${entry.current}`).join('; ')}`);
    this.name = 'ActionContractMismatchError';
  }
}

/** Raised when a contract is required but the capture cannot express one for the target (legacy node without affordance). */
export class ActionContractUnavailableError extends Error {
  constructor(readonly selector: string | undefined) {
    super(`action contract unavailable: resolved target ${selector ?? '(unknown)'} carries no observable affordance`);
    this.name = 'ActionContractUnavailableError';
  }
}

export interface DeriveActionContractInput {
  verb: ActionContractVerb;
  /** The resolved live node the verb will act on. */
  node: DistilledNode;
  /** Optional declared authoritative effect reference carried from the step. */
  requiredEffect?: ActionContractEffect;
}

/**
 * Derives the current, value-free action contract for a verb on a resolved node.
 * Pure: everything comes from the distilled node's identity, context, and
 * capture-time affordance. Throws `ActionContractUnavailableError` for a node
 * without affordance (a non-interactive or legacy capture).
 */
export function deriveActionContract(input: DeriveActionContractInput): ActionContract {
  const { node, verb } = input;
  if (verb !== 'navigate' && !node.affordance) throw new ActionContractUnavailableError(node.selectorHint);
  const affordance = node.affordance ?? { control: 'generic' as const, enter_behavior: 'none' as const, enabled: true, draggable: false };
  const { enabled, ...contractAffordance } = affordance;
  return {
    version: 1,
    verb,
    target: {
      role: node.role,
      name: node.name,
      stable_id: stableNodeRef(node.id),
      ...(node.context?.path.length ? { context_hash: node.context.contextHash } : {}),
    },
    affordance: contractAffordance,
    safety: deriveActionSafety(verb, affordance),
    preconditions: { visible: true, enabled },
    ...(input.requiredEffect ? { required_effect: input.requiredEffect } : {}),
  };
}

/**
 * Safety of a verb *on this control*: the verb's baseline class from E7.5, refined by
 * what the control observably does. A click is `navigation` on a link or a GET
 * submit, `mutating` on a POST submit, `local_input` on a checkbox/radio, and stays
 * `potentially_mutating` on an opaque button. Refinement never lowers below the
 * verb baseline for mutating verbs.
 */
export function deriveActionSafety(verb: ActionContractVerb, affordance: NonNullable<DistilledNode['affordance']>): ActionContractSafety {
  const baseline = classifyBrowserActionSafety(verb);
  if (verb !== 'click') return baseline;
  switch (affordance.control) {
    case 'link':
      return 'navigation';
    case 'submit':
      return affordance.form_method === 'post' ? 'mutating' : 'navigation';
    case 'checkbox':
    case 'radio':
      return 'local_input';
    default:
      return baseline;
  }
}

/** Compares a recorded contract with the live one; throws `ActionContractMismatchError` before dispatch on incompatibility. */
export function assertActionContract(recorded: ActionContract, current: ActionContract): ActionContractComparison {
  const comparison = compareActionContracts(recorded, current);
  // INVARIANT: target resolution is not permission to act — an incompatible
  // contract stops here, before any backend call.
  if (!comparison.compatible) throw new ActionContractMismatchError(comparison.mismatches, recorded, current);
  return comparison;
}
