import { diffObservations } from './diff.js';
import { estimateTokens, renderNodeLine, renderObservation } from './render.js';
import {
  AdaptiveRenderedObservationSchema,
  type AdaptiveRenderedObservation,
  type DistilledNode,
  type ObservationDiff,
} from './types.js';

/** Default emergency ceiling for an actionable snapshot that establishes an A4 diff base. */
export const DEFAULT_BOOTSTRAP_MAX_CHARS = 100_000;

/** Raised before planning when neither a budgeted diff nor a bounded grounded snapshot is safe. */
export class ObservationBootstrapLimitError extends Error {
  constructor(
    readonly observationChars: number,
    readonly maxBootstrapChars: number,
  ) {
    super(`grounded observation requires ${observationChars} characters, above bootstrap limit ${maxBootstrapChars}`);
    this.name = 'ObservationBootstrapLimitError';
  }
}

/** Budget and previous snapshot used for adaptive observation rendering. */
export interface AdaptiveRenderOptions {
  maxChars?: number;
  previousNodes?: readonly DistilledNode[];
  /** Emergency ceiling for a grounded snapshot when no budgeted representation exists. */
  maxBootstrapChars?: number;
}

/** Renders budgeted full/diff state, or one explicit bounded snapshot to establish a diff base. */
export function renderAdaptiveObservation(
  nodes: readonly DistilledNode[],
  options: AdaptiveRenderOptions = {},
): AdaptiveRenderedObservation {
  const maxChars = Math.max(0, options.maxChars ?? 4000);
  const maxBootstrapChars = Math.max(0, options.maxBootstrapChars ?? DEFAULT_BOOTSTRAP_MAX_CHARS);
  if (maxBootstrapChars < maxChars) {
    throw new RangeError('maxBootstrapChars cannot be smaller than maxChars');
  }

  const full = renderObservation(nodes, { maxChars: Number.MAX_SAFE_INTEGER });
  if (full.text.length <= maxChars) {
    return AdaptiveRenderedObservationSchema.parse({ ...full, mode: 'full' });
  }

  const diff = options.previousNodes ? diffObservations(options.previousNodes, nodes) : undefined;
  if (diff) {
    const diffText = renderDiff(diff);
    if (diffText.length <= maxChars) {
      return AdaptiveRenderedObservationSchema.parse({
        text: diffText,
        truncated: false,
        approxTokens: estimateTokens(diffText),
        mode: 'diff',
        diff,
      });
    }
  }

  // see docs/02-architecture.md "Tier 0 — working memory". A count-only
  // summary contains no selectors and cannot safely ground the next action. A4
  // also needs a real base before it can encode a delta. Pay for that base
  // explicitly under a second hard ceiling, then return to the ordinary budget.
  if (full.text.length <= maxBootstrapChars) {
    return AdaptiveRenderedObservationSchema.parse({
      ...full,
      mode: 'bootstrap',
      bootstrap: {
        budgetChars: maxChars,
        exceededByChars: full.text.length - maxChars,
      },
    });
  }

  // INVARIANT: never invite the planner to invent a selector from an
  // unactionable summary merely to preserve the nominal token budget.
  throw new ObservationBootstrapLimitError(full.text.length, maxBootstrapChars);
}

function renderDiff(diff: ObservationDiff): string {
  const lines = [
    ...diff.added.map((node) => `+ ${renderNodeLine(node)}`),
    ...diff.updated.map((node) => `~ ${renderNodeLine(node)}`),
    ...diff.removed.map((stableId) => `- [${stableId}]`),
  ];
  return lines.length === 0 ? '(no observation changes)' : lines.join('\n');
}
