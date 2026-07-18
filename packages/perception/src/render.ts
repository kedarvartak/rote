import type { DistilledNode, RenderedObservation, RenderOptions } from './types.js';

/** Renders distilled nodes into a compact observation with a hard character budget. */
export function renderObservation(nodes: readonly DistilledNode[], options: RenderOptions = {}): RenderedObservation {
  const maxChars = options.maxChars ?? 4000;
  const lines = nodes.map(renderNodeLine);
  const kept: string[] = [];
  let used = 0;

  for (const line of lines) {
    const next = `${line}\n`;
    if (used + next.length > maxChars) break;
    kept.push(line);
    used += next.length;
  }

  const truncated = kept.length < lines.length;
  const suffix = truncated ? `\n… truncated ${lines.length - kept.length} nodes` : '';
  const text = `${kept.join('\n')}${suffix}`.slice(0, maxChars);
  return { text, truncated, approxTokens: estimateTokens(text) };
}

/** Approximate token counter for budget tests; real provider accounting remains in @rote/bench. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Renders one distilled node in the compact planner-observation format. */
export function renderNodeLine(node: DistilledNode): string {
  const selector = node.selectorHint ? ` ${node.selectorHint}` : '';
  const marker = node.interactive ? '*' : '-';
  const state = node.state?.checked === undefined ? '' : ` checked=${String(node.state.checked)}`;
  return `${marker} [${node.id.hash}] ${node.role}${selector}${node.name ? ` "${node.name}"` : ''}${state}`;
}
