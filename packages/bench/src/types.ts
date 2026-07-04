import type { RunManifest, TokenUsageSource, TrajectoryEvent } from '@rote/core';

/** Benchmark phase from docs/03-wedge-benchmark.md's protocol. */
export type BenchPhase = 'cold' | 'warm' | 'drift';

/** One task class in the run-it-twice benchmark suite. */
export interface BenchTask {
  id: string;
  name: string;
  params?: Record<string, unknown>;
}

/** One concrete benchmark run request sent to an injected agent/executor driver. */
export interface BenchRunInput {
  task: BenchTask;
  phase: BenchPhase;
  repetition: number;
}

/** Successful driver output; failed driver calls are captured as failed cells instead of being dropped. */
export interface BenchRunSuccess {
  runId: string;
  manifest: RunManifest;
  trajectory: TrajectoryEvent[];
}

/** Boundary used by the harness to run either the plain agent (cold) or replay executor (warm/drift). */
export interface BenchDriver {
  run(input: BenchRunInput): Promise<BenchRunSuccess>;
}

/** One matrix cell, including failures, so reports cannot hide missing runs. */
export type BenchCell =
  | ({ status: 'success' } & BenchRunInput & BenchRunSuccess)
  | ({ status: 'failure'; error: string } & BenchRunInput);

/** Full benchmark result in deterministic matrix order. */
export interface BenchResult {
  cells: BenchCell[];
}

/** Token totals for one group of cells. */
export interface TokenTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  by_source: Partial<Record<TokenUsageSource, number>>;
}

/** Aggregated metrics for a task/phase group. */
export interface BenchSummaryRow {
  task: string;
  phase: BenchPhase;
  runs: number;
  successes: number;
  failures: number;
  tool_calls: number;
  duration_ms: number;
  tokens: TokenTotals;
}

/** Structured report data used by deterministic Markdown rendering. */
export interface BenchReport {
  rows: BenchSummaryRow[];
  comparisons: WarmComparison[];
}

/** Warm-vs-cold economics for one task, when both phases are present. */
export interface WarmComparison {
  task: string;
  cold_total_tokens: number;
  warm_total_tokens: number;
  token_reduction_ratio: number;
  cold_tool_calls: number;
  warm_tool_calls: number;
  tool_call_reduction_ratio: number;
}
