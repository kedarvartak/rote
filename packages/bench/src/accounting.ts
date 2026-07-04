import type { RunManifest, TokenUsageSource } from '@rote/core';
import type { BenchCell, BenchReport, BenchSummaryRow, TokenTotals, WarmComparison } from './types.js';

const SOURCES: TokenUsageSource[] = ['planner', 'matcher', 'slot', 'judgment', 'repair', 'verify', 'distill'];

/** Sums tagged provider usage from manifests; totals by source must add up exactly. */
export function summarizeTokenUsage(manifests: readonly RunManifest[]): TokenTotals {
  const by_source: Partial<Record<TokenUsageSource, number>> = {};
  let input_tokens = 0;
  let output_tokens = 0;

  for (const manifest of manifests) {
    for (const usage of manifest.token_usage) {
      input_tokens += usage.input_tokens;
      output_tokens += usage.output_tokens;
      by_source[usage.source] = (by_source[usage.source] ?? 0) + usage.input_tokens + usage.output_tokens;
    }
  }

  return { input_tokens, output_tokens, total_tokens: input_tokens + output_tokens, by_source };
}

/** Builds per-task/per-phase rows and warm-vs-cold comparisons from raw cells. */
export function buildBenchReport(cells: readonly BenchCell[]): BenchReport {
  const rows: BenchSummaryRow[] = [];
  const keys = [...new Set(cells.map((cell) => `${cell.task.id}\u0000${cell.phase}`))].sort();

  for (const key of keys) {
    const [task, phase] = key.split('\u0000') as [string, BenchSummaryRow['phase']];
    const group = cells.filter((cell) => cell.task.id === task && cell.phase === phase);
    const successes = group.filter((cell): cell is Extract<BenchCell, { status: 'success' }> => cell.status === 'success');
    rows.push({
      task,
      phase,
      runs: group.length,
      successes: successes.length,
      failures: group.length - successes.length,
      tool_calls: successes.reduce((sum, cell) => sum + cell.trajectory.length, 0),
      duration_ms: successes.reduce((sum, cell) => sum + durationMs(cell.manifest), 0),
      tokens: summarizeTokenUsage(successes.map((cell) => cell.manifest)),
    });
  }

  return { rows, comparisons: buildWarmComparisons(rows) };
}

/** Average per successful run; zero when no run succeeded. */
export function average(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

function durationMs(manifest: RunManifest): number {
  if (!manifest.ended_at) return 0;
  return Math.max(0, Date.parse(manifest.ended_at) - Date.parse(manifest.started_at));
}

function buildWarmComparisons(rows: readonly BenchSummaryRow[]): WarmComparison[] {
  const tasks = [...new Set(rows.map((row) => row.task))].sort();
  const comparisons: WarmComparison[] = [];

  for (const task of tasks) {
    const cold = rows.find((row) => row.task === task && row.phase === 'cold');
    const warm = rows.find((row) => row.task === task && row.phase === 'warm');
    if (!cold || !warm) continue;
    const coldTokens = average(cold.tokens.total_tokens, cold.successes);
    const warmTokens = average(warm.tokens.total_tokens, warm.successes);
    const coldCalls = average(cold.tool_calls, cold.successes);
    const warmCalls = average(warm.tool_calls, warm.successes);
    comparisons.push({
      task,
      cold_total_tokens: coldTokens,
      warm_total_tokens: warmTokens,
      token_reduction_ratio: ratioReduction(coldTokens, warmTokens),
      cold_tool_calls: coldCalls,
      warm_tool_calls: warmCalls,
      tool_call_reduction_ratio: ratioReduction(coldCalls, warmCalls),
    });
  }

  return comparisons;
}

function ratioReduction(baseline: number, current: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, 1 - current / baseline);
}

/** Ensures tests can assert that per-source accounting is exhaustive. */
export function sourceTotal(totals: TokenTotals): number {
  return SOURCES.reduce((sum, source) => sum + (totals.by_source[source] ?? 0), 0);
}
