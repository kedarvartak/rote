import { average } from './accounting.js';
import type { BenchReport, BenchSummaryRow, WarmComparison } from './types.js';

/** Deterministically renders the M3 benchmark report as Markdown. */
export function renderMarkdownReport(report: BenchReport): string {
  const lines: string[] = [
    '# Rote Benchmark Report',
    '',
    '## Summary',
    '',
    '| Task | Phase | Runs | Successes | Failures | Avg tokens | Avg tool calls | Avg duration ms |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const row of [...report.rows].sort(compareRows)) {
    lines.push(
      `| ${escapeCell(row.task)} | ${row.phase} | ${row.runs} | ${row.successes} | ${row.failures} | ${fmt(average(row.tokens.total_tokens, row.successes))} | ${fmt(average(row.tool_calls, row.successes))} | ${fmt(average(row.duration_ms, row.successes))} |`,
    );
  }

  lines.push('', '## Warm vs Cold', '', '| Task | Cold avg tokens | Warm avg tokens | Token reduction | Cold avg calls | Warm avg calls | Call reduction |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const comparison of [...report.comparisons].sort(compareComparisons)) {
    lines.push(
      `| ${escapeCell(comparison.task)} | ${fmt(comparison.cold_total_tokens)} | ${fmt(comparison.warm_total_tokens)} | ${pct(comparison.token_reduction_ratio)} | ${fmt(comparison.cold_tool_calls)} | ${fmt(comparison.warm_tool_calls)} | ${pct(comparison.tool_call_reduction_ratio)} |`,
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function compareRows(a: BenchSummaryRow, b: BenchSummaryRow): number {
  return a.task.localeCompare(b.task) || a.phase.localeCompare(b.phase);
}

function compareComparisons(a: WarmComparison, b: WarmComparison): number {
  return a.task.localeCompare(b.task);
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
