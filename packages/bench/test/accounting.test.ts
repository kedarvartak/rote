import { describe, expect, it } from 'vitest';
import { buildBenchReport, sourceTotal, summarizeTokenUsage } from '../src/accounting.js';
import { event, manifest } from './helpers.js';

describe('benchmark accounting', () => {
  it('sums usage totals by source exactly', () => {
    const totals = summarizeTokenUsage([
      manifest('r1', [
        { source: 'planner', input_tokens: 100, output_tokens: 25 },
        { source: 'slot', input_tokens: 10, output_tokens: 5 },
      ]),
      manifest('r2', [{ source: 'planner', input_tokens: 7, output_tokens: 3 }]),
    ]);

    expect(totals).toEqual({
      input_tokens: 117,
      output_tokens: 33,
      total_tokens: 150,
      by_source: { planner: 135, slot: 15 },
    });
    expect(sourceTotal(totals)).toBe(totals.total_tokens);
  });

  it('builds warm-vs-cold averages without double-counting failed cells', () => {
    const report = buildBenchReport([
      {
        status: 'success',
        task: { id: 'B1', name: 'download report' },
        phase: 'cold',
        repetition: 1,
        runId: 'cold-1',
        manifest: manifest('cold-1', [{ source: 'planner', input_tokens: 900, output_tokens: 100 }]),
        trajectory: [event('cold-1', 0), event('cold-1', 1), event('cold-1', 2), event('cold-1', 3)],
      },
      {
        status: 'success',
        task: { id: 'B1', name: 'download report' },
        phase: 'warm',
        repetition: 1,
        runId: 'warm-1',
        manifest: manifest('warm-1', [{ source: 'slot', input_tokens: 80, output_tokens: 20 }]),
        trajectory: [event('warm-1', 0)],
      },
      { status: 'failure', task: { id: 'B1', name: 'download report' }, phase: 'warm', repetition: 2, error: 'boom' },
    ]);

    expect(report.rows).toContainEqual(
      expect.objectContaining({ task: 'B1', phase: 'warm', runs: 2, successes: 1, failures: 1, tool_calls: 1 }),
    );
    expect(report.comparisons).toEqual([
      expect.objectContaining({
        task: 'B1',
        cold_total_tokens: 1000,
        warm_total_tokens: 100,
        token_reduction_ratio: 0.9,
        cold_tool_calls: 4,
        warm_tool_calls: 1,
        tool_call_reduction_ratio: 0.75,
      }),
    ]);
  });
});
