import { diffObservations } from './diff.js';
import { estimateTokens, renderNodeLine, renderObservation } from './render.js';
import {
  AdaptiveRenderedObservationSchema,
  type AdaptiveRenderedObservation,
  type DistilledNode,
  type ObservationDiff,
} from './types.js';

/** Budget and previous snapshot used for adaptive observation rendering. */
export interface AdaptiveRenderOptions {
  maxChars?: number;
  previousNodes?: readonly DistilledNode[];
}

/** Renders full state, then an ordered diff, then a summary as the character budget tightens. */
export function renderAdaptiveObservation(
  nodes: readonly DistilledNode[],
  options: AdaptiveRenderOptions = {},
): AdaptiveRenderedObservation {
  const maxChars = Math.max(0, options.maxChars ?? 4000);
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

  const summary = renderSummary(nodes, diff).slice(0, maxChars);
  return AdaptiveRenderedObservationSchema.parse({
    text: summary,
    truncated: true,
    approxTokens: estimateTokens(summary),
    mode: 'summary',
    ...(diff ? { diff } : {}),
  });
}

function renderDiff(diff: ObservationDiff): string {
  const lines = [
    ...diff.added.map((node) => `+ ${renderNodeLine(node)}`),
    ...diff.updated.map((node) => `~ ${renderNodeLine(node)}`),
    ...diff.removed.map((stableId) => `- [${stableId}]`),
  ];
  return lines.length === 0 ? '(no observation changes)' : lines.join('\n');
}

function renderSummary(nodes: readonly DistilledNode[], diff?: ObservationDiff): string {
  const interactive = nodes.filter((node) => node.interactive).length;
  const changes = diff
    ? ` changes=+${diff.added.length}/~${diff.updated.length}/-${diff.removed.length}`
    : '';
  return `observation summary: nodes=${nodes.length} interactive=${interactive}${changes}`;
}
