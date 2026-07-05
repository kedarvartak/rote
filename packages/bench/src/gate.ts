import type { BenchReport, BenchSummaryRow, WarmComparison } from './types.js';

export interface M3GateOptions {
  /** docs/06-build-plan.md M3 kill gate: warm replay must cut tokens by at least 80%. */
  minTokenReductionRatio?: number;
}

export interface M3GateTaskResult {
  task: string;
  passed: boolean;
  token_reduction_ratio: number;
  cold_success_rate: number;
  warm_success_rate: number;
  reasons: string[];
}

export interface M3GateResult {
  passed: boolean;
  minTokenReductionRatio: number;
  tasks: M3GateTaskResult[];
}

/** Raised by the CLI when the benchmark kill gate fails so CI gets a non-zero exit. */
export class M3GateFailedError extends Error {
  constructor(public readonly result: M3GateResult) {
    super(renderM3GateResult(result));
    this.name = 'M3GateFailedError';
  }
}

/** Evaluates docs/06-build-plan.md M3's kill gate: token cut plus success parity for every cold/warm task. */
export function evaluateM3Gate(report: BenchReport, options: M3GateOptions = {}): M3GateResult {
  const minTokenReductionRatio = options.minTokenReductionRatio ?? 0.8;
  const tasks = report.comparisons.map((comparison) => evaluateTask(report.rows, comparison, minTokenReductionRatio));
  return {
    passed: tasks.length > 0 && tasks.every((task) => task.passed),
    minTokenReductionRatio,
    tasks,
  };
}

/** Deterministically renders a concise gate result for humans and CI logs. */
export function renderM3GateResult(result: M3GateResult): string {
  const lines = [
    `M3 gate: ${result.passed ? 'PASS' : 'FAIL'} (min token reduction ${(result.minTokenReductionRatio * 100).toFixed(1)}%)`,
    '',
    '| Task | Token reduction | Cold success | Warm success | Status | Reasons |',
    '|---|---:|---:|---:|---|---|',
  ];

  for (const task of [...result.tasks].sort((a, b) => a.task.localeCompare(b.task))) {
    lines.push(
      `| ${escapeCell(task.task)} | ${pct(task.token_reduction_ratio)} | ${pct(task.cold_success_rate)} | ${pct(task.warm_success_rate)} | ${task.passed ? 'PASS' : 'FAIL'} | ${escapeCell(task.reasons.join('; ') || 'ok')} |`,
    );
  }

  if (result.tasks.length === 0) lines.push('| — | 0.0% | 0.0% | 0.0% | FAIL | no cold/warm comparisons found |');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function evaluateTask(rows: readonly BenchSummaryRow[], comparison: WarmComparison, minTokenReductionRatio: number): M3GateTaskResult {
  const cold = rows.find((row) => row.task === comparison.task && row.phase === 'cold');
  const warm = rows.find((row) => row.task === comparison.task && row.phase === 'warm');
  const coldSuccessRate = successRate(cold);
  const warmSuccessRate = successRate(warm);
  const reasons: string[] = [];

  if (comparison.token_reduction_ratio < minTokenReductionRatio) {
    reasons.push(`token reduction ${pct(comparison.token_reduction_ratio)} < ${pct(minTokenReductionRatio)}`);
  }
  if (warmSuccessRate < coldSuccessRate) {
    reasons.push(`warm success ${pct(warmSuccessRate)} < cold success ${pct(coldSuccessRate)}`);
  }
  if (!cold || !warm) reasons.push('missing cold or warm row');

  return {
    task: comparison.task,
    passed: reasons.length === 0,
    token_reduction_ratio: comparison.token_reduction_ratio,
    cold_success_rate: coldSuccessRate,
    warm_success_rate: warmSuccessRate,
    reasons,
  };
}

function successRate(row: BenchSummaryRow | undefined): number {
  if (!row || row.runs === 0) return 0;
  return row.successes / row.runs;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|');
}
