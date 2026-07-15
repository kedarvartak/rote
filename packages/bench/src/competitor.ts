import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { OutcomeSchema } from '@rote/core';
import { average } from './accounting.js';
import { DEFAULT_PRICE_TABLE, priceForModel, runCostUsd, type PriceTable } from './pricing.js';
import { percentileOf } from './stats.js';
import type { BenchCell, BenchPhase } from './types.js';

const PHASES: readonly BenchPhase[] = ['cold', 'warm', 'drift'];

/**
 * One harness run in the neutral unit used for cross-harness comparison.
 *
 * Competitors (Browser Use, Stagehand-agent, …) do not share Rote's per-source
 * token tags (`planner|slot|verify|…`), so the head-to-head collapses to total
 * input/output tokens for the whole task. Fairness provenance travels with every
 * record so the published number can be audited — see docs/03-benchmark.md
 * "fairness rules" (same model, best-effort competitor config, cache-adjusted
 * token counts, success parity reported per task).
 */
export const CompetitorRunRecordSchema = z.object({
  /** Harness identity, e.g. `rote`, `browser-use`, `stagehand-agent`. */
  harness: z.string().min(1),
  task: z.string().min(1),
  phase: z.enum(['cold', 'warm', 'drift']).default('cold'),
  repetition: z.number().int().nonnegative(),
  outcome: OutcomeSchema,
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  model: z.string().min(1),
  // docs/03: token counts must be cache-adjusted before comparison. We do not
  // silently assume it — the record states it so an un-adjusted comparison is
  // visible in the raw data and gate-able.
  cache_adjusted: z.boolean(),
  config_notes: z.string().optional(),
});
export type CompetitorRunRecord = z.infer<typeof CompetitorRunRecordSchema>;

/** A non-empty array of neutral run records for one head-to-head comparison. */
export const CompetitorRecordsSchema = z.array(CompetitorRunRecordSchema).min(1);

const CompetitorRecordsFileSchema = z.union([
  CompetitorRecordsSchema,
  z.object({ records: CompetitorRecordsSchema }),
]);

/** Reads and validates a head-to-head records file (array or `{ records: [...] }`). */
export async function readCompetitorRecords(path: string): Promise<CompetitorRunRecord[]> {
  const parsed = CompetitorRecordsFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  return Array.isArray(parsed) ? parsed : parsed.records;
}

/** Per-`(task, harness)` aggregate; token/duration/cost averages are over successes only. */
export interface HarnessTaskSummary {
  task: string;
  harness: string;
  runs: number;
  successes: number;
  success_rate: number;
  avg_total_tokens: number;
  avg_duration_ms: number;
  /** Median wall-clock of a successful run, in ms (docs/05 W5 G1 latency-per-phase). */
  p50_duration_ms: number;
  /** 95th-percentile wall-clock of a successful run, in ms — the tail users feel. */
  p95_duration_ms: number;
  /**
   * Mean USD per successful run, or `undefined` when the price table does not
   * price this harness's model. Undefined means *unpriced*, never free — the
   * report labels it rather than rendering $0.
   */
  avg_cost_usd?: number;
  /** Total tokens per successful run, in record order — the variance gate reads this. */
  success_total_tokens: number[];
}

/** One task's subject-vs-baseline head-to-head. */
export interface HeadToHeadComparison {
  task: string;
  subject: HarnessTaskSummary;
  baseline: HarnessTaskSummary;
  /** 1 - subject_avg/baseline_avg over successful runs; clamped to ≥ 0. */
  token_reduction_ratio: number;
  /** Wall-clock reduction, same form as the token ratio (reported, not gated in V1). */
  latency_reduction_ratio: number;
  /** $-per-task reduction; `undefined` when either side's model is unpriced. */
  cost_reduction_ratio?: number;
  /** True when the subject's success rate is at least the baseline's (docs/05 parity). */
  success_parity: boolean;
}

export interface HeadToHeadResult {
  subject_harness: string;
  comparisons: HeadToHeadComparison[];
  /** Price table the $ columns were computed with; rendered so the number is auditable. */
  prices: PriceTable;
}

export interface RoteRecordOptions {
  /** Model the Rote runs used, recorded for fairness provenance. */
  model: string;
  /** Whether the Rote token counts are already cache-adjusted (docs/03). */
  cacheAdjusted: boolean;
  /** Harness label; defaults to `rote`. */
  harness?: string;
  configNotes?: string;
}

/**
 * Collapses Rote's per-source manifest accounting into neutral head-to-head
 * records — the apples-to-apples bridge. Rote's rich `token_usage[]` tags are
 * summed into one input/output total per task so the same task competes on the
 * same unit as a competitor that only reports a lump total.
 *
 * Failure cells carry no manifest (see BenchCell), so they contribute a
 * `failure` outcome with zero tokens: they never inflate the token average
 * (which is over successes) but they do lower the success rate that the parity
 * gate reads.
 */
export function roteRecordsFromCells(
  cells: readonly BenchCell[],
  options: RoteRecordOptions,
): CompetitorRunRecord[] {
  const harness = options.harness ?? 'rote';
  return cells.map((cell) => {
    const base = {
      harness,
      task: cell.task.id,
      phase: cell.phase,
      repetition: cell.repetition,
      model: options.model,
      cache_adjusted: options.cacheAdjusted,
      ...(options.configNotes ? { config_notes: options.configNotes } : {}),
    };
    if (cell.status === 'failure') {
      return CompetitorRunRecordSchema.parse({
        ...base,
        outcome: 'failure',
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: 0,
      });
    }
    let input = 0;
    let output = 0;
    for (const usage of cell.manifest.token_usage) {
      input += usage.input_tokens;
      output += usage.output_tokens;
    }
    return CompetitorRunRecordSchema.parse({
      ...base,
      outcome: cell.manifest.outcome,
      input_tokens: input,
      output_tokens: output,
      duration_ms: manifestDurationMs(cell.manifest.started_at, cell.manifest.ended_at),
    });
  });
}

/** Aggregates neutral records into per-`(task, harness)` summaries, deterministically ordered. */
export function summarizeHarnessRuns(
  records: readonly CompetitorRunRecord[],
  prices: PriceTable = DEFAULT_PRICE_TABLE,
): HarnessTaskSummary[] {
  const validated = CompetitorRecordsSchema.parse(records);
  const keys = [...new Set(validated.map((r) => `${r.task}\u0000${r.harness}`))].sort();
  return keys.map((key) => {
    const [task, harness] = key.split('\u0000') as [string, string];
    const group = validated.filter((r) => r.task === task && r.harness === harness);
    const successes = group.filter((r) => r.outcome === 'success');
    const successTokens = successes.map((r) => r.input_tokens + r.output_tokens);
    const durations = successes.map((r) => r.duration_ms);
    return {
      task,
      harness,
      runs: group.length,
      successes: successes.length,
      success_rate: group.length === 0 ? 0 : successes.length / group.length,
      avg_total_tokens: average(successTokens.reduce((s, t) => s + t, 0), successes.length),
      avg_duration_ms: average(durations.reduce((s, d) => s + d, 0), successes.length),
      p50_duration_ms: percentileOf(durations, 0.5),
      p95_duration_ms: percentileOf(durations, 0.95),
      ...costOf(successes, prices),
      success_total_tokens: successTokens,
    };
  });
}

/**
 * Mean USD per successful run, omitted entirely when any successful run's model
 * is unpriced. Omitted rather than partial: averaging only the priced subset
 * would quietly under-report a harness's cost, and a $0 would read as free.
 */
function costOf(
  successes: readonly CompetitorRunRecord[],
  prices: PriceTable,
): { avg_cost_usd?: number } {
  if (successes.length === 0) return {};
  const costs: number[] = [];
  for (const run of successes) {
    const price = priceForModel(run.model, prices);
    if (!price) return {};
    costs.push(runCostUsd(run.input_tokens, run.output_tokens, price));
  }
  return { avg_cost_usd: costs.reduce((s, c) => s + c, 0) / costs.length };
}

export interface HeadToHeadOptions {
  /** The harness under test whose economics we are defending. Defaults to `rote`. */
  subject?: string;
  /** Price table for the $-per-task column; defaults to the dated built-in table. */
  prices?: PriceTable;
}

/**
 * Builds per-task subject-vs-baseline comparisons: for every task where the
 * subject harness and at least one other (baseline) harness both ran, emit one
 * comparison per baseline. Deterministically ordered by task then baseline.
 */
export function buildHeadToHead(
  records: readonly CompetitorRunRecord[],
  options: HeadToHeadOptions = {},
): HeadToHeadResult {
  const subjectHarness = options.subject ?? 'rote';
  const summaries = summarizeHarnessRuns(records, options.prices);
  const comparisons: HeadToHeadComparison[] = [];
  const tasks = [...new Set(summaries.map((s) => s.task))].sort();

  for (const task of tasks) {
    const subject = summaries.find((s) => s.task === task && s.harness === subjectHarness);
    if (!subject) continue;
    const baselines = summaries
      .filter((s) => s.task === task && s.harness !== subjectHarness)
      .sort((a, b) => a.harness.localeCompare(b.harness));
    for (const baseline of baselines) {
      comparisons.push({
        task,
        subject,
        baseline,
        token_reduction_ratio: reductionRatio(baseline.avg_total_tokens, subject.avg_total_tokens),
        latency_reduction_ratio: reductionRatio(baseline.avg_duration_ms, subject.avg_duration_ms),
        // Omitted unless both sides are priced — a reduction against an unpriced
        // (hence unknown) baseline is not a number we can stand behind.
        ...(subject.avg_cost_usd !== undefined && baseline.avg_cost_usd !== undefined
          ? { cost_reduction_ratio: reductionRatio(baseline.avg_cost_usd, subject.avg_cost_usd) }
          : {}),
        success_parity: subject.success_rate >= baseline.success_rate,
      });
    }
  }

  return { subject_harness: subjectHarness, comparisons, prices: options.prices ?? DEFAULT_PRICE_TABLE };
}

/** Deterministically renders the head-to-head economics as Markdown. */
export function renderHeadToHeadReport(result: HeadToHeadResult): string {
  const prices = result.prices;
  const lines: string[] = [
    '# Rote Head-to-Head Benchmark',
    '',
    `Subject harness: \`${result.subject_harness}\``,
    '',
    '## Reductions (subject vs baseline, at the reported success parity)',
    '',
    '| Task | Baseline | Tokens | Latency | $/task | Parity |',
    '|---|---|---:|---:|---:|---|',
  ];
  for (const c of result.comparisons) {
    lines.push(
      `| ${cell(c.task)} | ${cell(c.baseline.harness)} | ${pct(c.token_reduction_ratio)} | ${pct(c.latency_reduction_ratio)} | ${c.cost_reduction_ratio === undefined ? 'price unavailable' : pct(c.cost_reduction_ratio)} | ${c.success_parity ? 'yes' : 'NO'} |`,
    );
  }
  if (result.comparisons.length === 0) {
    lines.push('| — | — | 0.0% | 0.0% | price unavailable | NO |');
  }

  lines.push(
    '',
    '## Per-harness detail (averages over successful runs)',
    '',
    '| Task | Harness | Runs | Success | Avg tokens | Avg latency (ms) | p50 (ms) | p95 (ms) | $/task |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const summary of harnessRows(result)) {
    lines.push(
      `| ${cell(summary.task)} | ${cell(summary.harness)} | ${summary.runs} | ${pct(summary.success_rate)} | ${fmt(summary.avg_total_tokens)} | ${fmt(summary.avg_duration_ms)} | ${fmt(summary.p50_duration_ms)} | ${fmt(summary.p95_duration_ms)} | ${usd(summary.avg_cost_usd)} |`,
    );
  }
  if (result.comparisons.length === 0) {
    lines.push('| — | — | 0 | 0.0% | 0 | 0 | 0 | price unavailable |');
  }

  lines.push(
    '',
    `Prices: \`${prices.version}\` (${prices.source}). Token counts are cache-adjusted only where every`,
    'record says so — check `cache_adjusted` on the records before quoting $/task.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

/** Subject-then-baselines, deduplicated, in comparison order — deterministic rendering. */
function harnessRows(result: HeadToHeadResult): HarnessTaskSummary[] {
  const rows: HarnessTaskSummary[] = [];
  const seen = new Set<string>();
  for (const comparison of result.comparisons) {
    for (const summary of [comparison.subject, comparison.baseline]) {
      const key = `${summary.task}\u0000${summary.harness}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(summary);
    }
  }
  return rows;
}

/** Renders USD per task, labelling an unpriced model rather than showing $0. */
function usd(value: number | undefined): string {
  return value === undefined ? 'price unavailable' : `$${value.toFixed(4)}`;
}

function manifestDurationMs(startedAt: string, endedAt?: string): number {
  if (!endedAt) return 0;
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}

function reductionRatio(baseline: number, subject: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, 1 - subject / baseline);
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Re-exported so callers can enumerate valid phases without importing types alone. */
export { PHASES as COMPETITOR_PHASES };
