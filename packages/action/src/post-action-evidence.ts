import type { CapturedPage } from '@rote/browser';
import { z } from 'zod';
import { diffObservations, distillPage, matchesElementSelector, ObservationIdentityError } from '@rote/perception';

/** Action subset whose observable effect can be derived without a model-authored prediction. */
export const ObservableBrowserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().min(1) }),
  z.object({ kind: z.literal('fill'), value: z.string() }),
  z.object({ kind: z.literal('select'), value: z.string() }),
  z.object({ kind: z.literal('click') }),
  z.object({ kind: z.literal('hover') }),
  z.object({ kind: z.literal('press') }),
  z.object({ kind: z.literal('upload') }),
  z.object({ kind: z.literal('dragAndDrop') }),
]);
/** Browser action shape accepted by transition evidence derivation. */
export type ObservableBrowserAction = z.infer<typeof ObservableBrowserActionSchema>;

/** Redacted evidence derived from the settled page transition after an action. */
export const PostActionEvidenceSchema = z.object({
  action_kind: z.enum(['navigate', 'fill', 'select', 'click', 'hover', 'press', 'upload', 'dragAndDrop']),
  strength: z.enum(['strong', 'reaction']),
  classification: z.enum([
    'exact_effect_observed',
    'exact_effect_missing',
    'click_reaction_observed',
    'click_no_observable_reaction',
    'click_reaction_unavailable',
    'reaction_observed',
    'no_observable_reaction',
    'reaction_unavailable',
  ]),
  passed: z.boolean(),
  enforced: z.boolean(),
  target: z.string().min(1).optional(),
});
/** Redacted strong-effect or shadow-reaction result retained on an agent step. */
export type PostActionEvidence = z.infer<typeof PostActionEvidenceSchema>;

/** Raised when a strong observed action effect is absent after settled dispatch. */
export class PostActionEvidenceError extends Error {
  constructor(
    readonly evidence: PostActionEvidence,
    readonly pageUrl: string,
  ) {
    super(`${evidence.action_kind} did not produce its required observable effect`);
    this.name = 'PostActionEvidenceError';
  }
}

/**
 * Derives redacted post-action evidence from settled captures without an LLM call.
 *
 * Click/hover/press/upload/dragAndDrop evidence is reaction-only and never enforced:
 * unrelated mutation can false-pass, while downloads and other external effects can
 * legitimately leave no DOM diff. Upload correctness is enforced at dispatch instead
 * (the backend verifies file-input assignment in the same evaluation), and declared
 * authoritative outcomes are decided by E7.4 evidence (#130).
 */
export function derivePostActionEvidence(input: {
  action: ObservableBrowserAction;
  resolvedSelector?: string;
  before: CapturedPage;
  after: CapturedPage;
}): PostActionEvidence {
  const action = ObservableBrowserActionSchema.parse(input.action);
  if (action.kind === 'fill' || action.kind === 'select') {
    const selector = requiredTarget(input.resolvedSelector, action.kind);
    const element = input.after.elements.find((candidate) => matchesElementSelector(candidate, selector));
    const passed = element?.attributes['value'] === action.value;
    return PostActionEvidenceSchema.parse({
      action_kind: action.kind,
      strength: 'strong',
      classification: passed ? 'exact_effect_observed' : 'exact_effect_missing',
      passed,
      enforced: true,
      target: selector,
    });
  }
  if (action.kind === 'navigate') {
    const target = canonicalUrl(action.url, input.before.url);
    const passed = canonicalUrl(input.after.url, input.before.url) === target;
    return PostActionEvidenceSchema.parse({
      action_kind: action.kind,
      strength: 'strong',
      classification: passed ? 'exact_effect_observed' : 'exact_effect_missing',
      passed,
      enforced: true,
    });
  }

  // Reaction-only verbs. `upload`'s strong gate is dispatch-time — the backend
  // verifies file-input assignment in the same evaluation and throws — because
  // `files` is a live property no capture serializes; `hover`/`press`/`dragAndDrop`
  // effects are app-defined. None of these classifications can promote unrelated
  // DOM churn into success: reactions are never enforced, and a task that
  // declares an authoritative outcome is decided by E7.4 evidence (#130), not
  // by this diff.
  const kind = action.kind;
  const [observed, none, unavailable] = kind === 'click'
    ? (['click_reaction_observed', 'click_no_observable_reaction', 'click_reaction_unavailable'] as const)
    : (['reaction_observed', 'no_observable_reaction', 'reaction_unavailable'] as const);
  const urlChanged = canonicalUrl(input.before.url, input.before.url) !== canonicalUrl(input.after.url, input.before.url);
  if (urlChanged) {
    return PostActionEvidenceSchema.parse({
      action_kind: kind,
      strength: 'reaction',
      classification: observed,
      passed: true,
      enforced: false,
      ...(input.resolvedSelector ? { target: input.resolvedSelector } : {}),
    });
  }
  try {
    const diff = diffObservations(distillPage(input.before), distillPage(input.after));
    const changed = diff.added.length + diff.updated.length + diff.removed.length > 0;
    return PostActionEvidenceSchema.parse({
      action_kind: kind,
      strength: 'reaction',
      classification: changed ? observed : none,
      passed: changed,
      // see docs/02-architecture.md "Decision for #54" — reaction is not proof.
      enforced: false,
      ...(input.resolvedSelector ? { target: input.resolvedSelector } : {}),
    });
  } catch (error) {
    if (!(error instanceof ObservationIdentityError)) throw error;
    return PostActionEvidenceSchema.parse({
      action_kind: kind,
      strength: 'reaction',
      classification: unavailable,
      passed: false,
      enforced: false,
      ...(input.resolvedSelector ? { target: input.resolvedSelector } : {}),
    });
  }
}

/** Throws only for an enforced strong effect; shadow click evidence remains diagnostic. */
export function assertPostActionEvidence(evidence: PostActionEvidence, pageUrl: string): void {
  const parsed = PostActionEvidenceSchema.parse(evidence);
  if (parsed.enforced && !parsed.passed) throw new PostActionEvidenceError(parsed, pageUrl);
}

function requiredTarget(selector: string | undefined, kind: 'fill' | 'select'): string {
  if (!selector) throw new Error(`${kind} post-action evidence requires a resolved selector`);
  return selector;
}

function canonicalUrl(value: string, base: string): string {
  return new URL(value, base).href;
}

