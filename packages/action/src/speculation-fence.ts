import { z } from 'zod';
import { ActionContractSchema, type ActionContract } from '@rote/core';

// see docs/02-architecture.md "Speculative execution (designed)" and P3 issue
// #192 — "the classifier is versioned and exhaustive: any unclassified action is
// an effect boundary and cannot be speculated."
//
// This is the refusal, built before the mechanism it refuses for, in the same
// order the predictor's kill gate came before the predictor's systems work. It
// dispatches nothing and knows nothing about shadow contexts; it answers one
// question about one already-derived action contract: *could* running this early
// reach past the effect boundary? Everything it cannot prove safe is unsafe, so
// a verb, control, or destination it has never heard of is an external effect
// rather than an unhandled case.

/** Fence version; a stored verdict names the rules that produced it. */
export const SPECULATION_FENCE_VERSION = 1 as const;

/**
 * Effect classes from docs/02: how far the *worst case* of running this action
 * reaches. `local_write` changes state inside the page; `external_effect` can
 * leave the browser (a request that mutates a server, a download, a cross-origin
 * navigation).
 */
export const SpeculationClassSchema = z.enum(['pure_read', 'local_nav', 'local_write', 'external_effect']);
export type SpeculationClass = z.infer<typeof SpeculationClassSchema>;

/** Why the fence assigned the class it did; every refusal names its rule. */
export const SpeculationReasonSchema = z.enum([
  'read_only_verb',
  'local_control_write',
  'same_origin_link',
  'same_origin_navigation',
  'unclassified_verb',
  'unclassified_control',
  'mutating_verb',
  'submit_control',
  'form_method_mutating',
  'cross_origin_destination',
  'download_destination',
  'unknown_destination',
  'chord_commits',
  'precondition_unmet',
  'stale_document',
  'ambiguous_target',
  'contract_mismatch',
]);
export type SpeculationReason = z.infer<typeof SpeculationReasonSchema>;

export interface SpeculationVerdict {
  version: typeof SPECULATION_FENCE_VERSION;
  class: SpeculationClass;
  reason: SpeculationReason;
}

/** Everything the fence may look at. Value-free: identities and shapes, never content. */
export const SpeculationInputSchema = z.object({
  contract: ActionContractSchema,
  /**
   * Same-origin destination digests the fence may treat as navigable. A
   * destination absent from this set is unknown, and unknown is not safe.
   */
  knownSameOriginDestinations: z.array(z.string().length(16)).default([]),
  /** Destinations observed to start a download; never speculable. */
  downloadDestinations: z.array(z.string().length(16)).default([]),
  /** Document generation the contract was derived against, and the live one. */
  recordedDocumentGeneration: z.number().int().nonnegative().optional(),
  currentDocumentGeneration: z.number().int().nonnegative().optional(),
  /** True when target resolution left more than one candidate (identity v2 residual ambiguity). */
  targetAmbiguous: z.boolean().default(false),
  /**
   * True when the live control's derived contract no longer equals the recorded
   * one. Comparing them is the action-contract gate's job (#143); the fence only
   * needs to know that they disagree, because speculating on a control whose
   * behaviour has changed is the exact failure the gate exists to prevent.
   */
  contractMismatch: z.boolean().default(false),
}).strict();
export type SpeculationInput = z.input<typeof SpeculationInputSchema>;

type ParsedSpeculationInput = z.infer<typeof SpeculationInputSchema>;

const EXTERNAL = (reason: SpeculationReason): SpeculationVerdict => ({ version: SPECULATION_FENCE_VERSION, class: 'external_effect', reason });
const classified = (klass: SpeculationClass, reason: SpeculationReason): SpeculationVerdict => ({ version: SPECULATION_FENCE_VERSION, class: klass, reason });

/**
 * Classifies how far one action could reach if it ran early.
 *
 * Pure and total: every input returns a verdict and the default is
 * `external_effect`. Ordering matters — staleness and target ambiguity are
 * checked first, because a verdict derived against a document that no longer
 * exists describes a control that may no longer be the one under the cursor.
 */
export function classifySpeculation(input: SpeculationInput): SpeculationVerdict {
  const parsed = SpeculationInputSchema.parse(input);
  const { contract } = parsed;

  if (
    parsed.recordedDocumentGeneration !== undefined
    && parsed.currentDocumentGeneration !== undefined
    && parsed.recordedDocumentGeneration !== parsed.currentDocumentGeneration
  ) {
    return EXTERNAL('stale_document');
  }
  if (parsed.contractMismatch) return EXTERNAL('contract_mismatch');
  if (parsed.targetAmbiguous) return EXTERNAL('ambiguous_target');
  if (!contract.preconditions.enabled) return EXTERNAL('precondition_unmet');

  // A form that posts is an external effect whatever verb touches it.
  if (contract.affordance.form_method === 'post') return EXTERNAL('form_method_mutating');

  switch (contract.verb) {
    case 'hover':
      return classified('pure_read', 'read_only_verb');

    case 'upload':
    case 'dragAndDrop':
      // Their whole purpose is a state transfer (docs/02 E7.5 safety classes).
      return EXTERNAL('mutating_verb');

    case 'fill':
    case 'select':
      return classified('local_write', 'local_control_write');

    case 'press':
      // A chord on a control whose Enter submits commits the form.
      return contract.affordance.enter_behavior === 'submits_form'
        ? EXTERNAL('chord_commits')
        : classified('local_write', 'local_control_write');

    case 'navigate':
      return destinationVerdict(parsed, 'same_origin_navigation');

    case 'click':
      switch (contract.affordance.control) {
        case 'submit':
          return EXTERNAL('submit_control');
        case 'checkbox':
        case 'radio':
          return classified('local_write', 'local_control_write');
        case 'link':
          return destinationVerdict(parsed, 'same_origin_link');
        default:
          // A button's handler is arbitrary page code; the fence cannot see it.
          return EXTERNAL('unclassified_control');
      }

    default:
      // Exhaustive by construction: a verb added without a rule here becomes an
      // effect boundary, never an unhandled case.
      return EXTERNAL('unclassified_verb');
  }
}

function destinationVerdict(parsed: ParsedSpeculationInput, reason: SpeculationReason): SpeculationVerdict {
  const destination = parsed.contract.affordance.destination_hash;
  if (!destination) return EXTERNAL('unknown_destination');
  if (parsed.downloadDestinations.includes(destination)) return EXTERNAL('download_destination');
  if (!parsed.knownSameOriginDestinations.includes(destination)) return EXTERNAL('cross_origin_destination');
  return classified('local_nav', reason);
}

/**
 * Which classes a speculation policy may act on.
 *
 * The default is `pure_read` alone, matching P3.2 (#191, prefetch of predicted
 * *observations*). Widening it is a deliberate, reviewable act: P3.3 (#192) is
 * where `local_nav` becomes eligible, behind a shadow context that can be
 * discarded. `external_effect` is never permitted — that is the fence.
 */
export const SpeculationPolicySchema = z.object({
  permit: z.array(SpeculationClassSchema).default(['pure_read']),
}).strict();
export type SpeculationPolicy = z.input<typeof SpeculationPolicySchema>;

/** Raised when a policy tries to permit the class the fence exists to forbid. */
export class SpeculationPolicyError extends Error {
  constructor() {
    super('a speculation policy may never permit external_effect');
    this.name = 'SpeculationPolicyError';
  }
}

/**
 * Decides whether a verdict may be acted on under a policy.
 *
 * INVARIANT: `external_effect` is unspeculable regardless of policy, and a policy
 * that names it is rejected rather than quietly ignored — a config that believes
 * it enabled something must not run as if it had not.
 */
export function maySpeculate(verdict: SpeculationVerdict, policy: SpeculationPolicy = {}): boolean {
  const parsed = SpeculationPolicySchema.parse(policy);
  if (parsed.permit.includes('external_effect')) throw new SpeculationPolicyError();
  if (verdict.class === 'external_effect') return false;
  return parsed.permit.includes(verdict.class);
}

/** Classify and decide in one call, for a caller holding a contract. */
export function speculationAllowed(input: SpeculationInput, policy: SpeculationPolicy = {}): { verdict: SpeculationVerdict; allowed: boolean } {
  const verdict = classifySpeculation(input);
  return { verdict, allowed: maySpeculate(verdict, policy) };
}

export type { ActionContract };
