import { describe, expect, it } from 'vitest';
import { renderMarkdownReport } from '../src/report.js';

describe('renderMarkdownReport', () => {
  it('is byte-stable for the same structured report', () => {
    const report = {
      rows: [
        {
          task: 'B1',
          phase: 'warm' as const,
          runs: 1,
          successes: 1,
          failures: 0,
          tool_calls: 1,
          duration_ms: 500,
          tokens: { input_tokens: 80, output_tokens: 20, total_tokens: 100, by_source: { slot: 100 } },
        },
        {
          task: 'B1',
          phase: 'cold' as const,
          runs: 1,
          successes: 1,
          failures: 0,
          tool_calls: 4,
          duration_ms: 1000,
          tokens: { input_tokens: 900, output_tokens: 100, total_tokens: 1000, by_source: { planner: 1000 } },
        },
      ],
      comparisons: [
        {
          task: 'B1',
          cold_total_tokens: 1000,
          warm_total_tokens: 100,
          token_reduction_ratio: 0.9,
          cold_tool_calls: 4,
          warm_tool_calls: 1,
          tool_call_reduction_ratio: 0.75,
        },
      ],
    };

    const markdown = renderMarkdownReport(report);
    expect(renderMarkdownReport(report)).toBe(markdown);
    expect(markdown).toMatchInlineSnapshot(`
      "# Rote Benchmark Report

      ## Summary

      | Task | Phase | Runs | Successes | Failures | Avg tokens | Avg tool calls | Avg duration ms |
      |---|---:|---:|---:|---:|---:|---:|---:|
      | B1 | cold | 1 | 1 | 0 | 1000 | 4 | 1000 |
      | B1 | warm | 1 | 1 | 0 | 100 | 1 | 500 |

      ## Warm vs Cold

      | Task | Cold avg tokens | Warm avg tokens | Token reduction | Cold avg calls | Warm avg calls | Call reduction |
      |---|---:|---:|---:|---:|---:|---:|
      | B1 | 1000 | 100 | 90.0% | 4 | 1 | 75.0% |

      "
    `);
  });
});
