import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildHeadToHead,
  readCompetitorRecords,
  renderHeadToHeadReport,
  roteRecordsFromCells,
  summarizeHarnessRuns,
  type CompetitorRunRecord,
} from '../src/competitor.js';
import { bootstrapReductionInterval, evaluateLaunchGate } from '../src/competitor-gate.js';
import type { BenchCell } from '../src/types.js';
import { manifest } from './helpers.js';

function record(overrides: Partial<CompetitorRunRecord>): CompetitorRunRecord {
  return {
    harness: 'rote',
    task: 'B1',
    phase: 'cold',
    repetition: 0,
    outcome: 'success',
    input_tokens: 100,
    output_tokens: 20,
    duration_ms: 1000,
    model: 'claude-opus-4-8',
    cache_adjusted: true,
    ...overrides,
  };
}

function failureCell(task: string, rep: number): BenchCell {
  return { status: 'failure', error: 'boom', task: { id: task, name: task }, phase: 'cold', repetition: rep };
}

describe('roteRecordsFromCells', () => {
  it('sums per-source manifest usage into one neutral total per successful task', () => {
    const cell: BenchCell = {
      status: 'success',
      task: { id: 'B1', name: 'B1' },
      phase: 'warm',
      repetition: 2,
      runId: 'B1-2',
      manifest: manifest('B1-2', [
        { source: 'planner', input_tokens: 40, output_tokens: 10 },
        { source: 'verify', input_tokens: 5, output_tokens: 1 },
      ]),
      trajectory: [],
    };
    const [rec] = roteRecordsFromCells([cell], { model: 'm', cacheAdjusted: true });
    expect(rec).toMatchObject({
      harness: 'rote',
      task: 'B1',
      phase: 'warm',
      repetition: 2,
      outcome: 'success',
      input_tokens: 45,
      output_tokens: 11,
      cache_adjusted: true,
    });
    // 2026-01-01T00:00:00 → 00:00:01 in the helper manifest.
    expect(rec.duration_ms).toBe(1000);
  });

  it('records a failed cell as a zero-token failure so it lowers success rate but not token averages', () => {
    const [rec] = roteRecordsFromCells([failureCell('B1', 0)], { model: 'm', cacheAdjusted: false });
    expect(rec).toMatchObject({ outcome: 'failure', input_tokens: 0, output_tokens: 0, duration_ms: 0 });
  });
});

describe('summarizeHarnessRuns', () => {
  it('averages tokens over successes only and reports success rate over all runs', () => {
    const records = [
      record({ harness: 'rote', repetition: 0, input_tokens: 100, output_tokens: 0 }),
      record({ harness: 'rote', repetition: 1, input_tokens: 200, output_tokens: 0 }),
      record({ harness: 'rote', repetition: 2, outcome: 'failure', input_tokens: 0, output_tokens: 0 }),
    ];
    const [summary] = summarizeHarnessRuns(records);
    expect(summary).toMatchObject({ task: 'B1', harness: 'rote', runs: 3, successes: 2 });
    expect(summary.avg_total_tokens).toBe(150);
    expect(summary.success_rate).toBeCloseTo(2 / 3);
    expect(summary.success_total_tokens).toEqual([100, 200]);
  });

  it('is deterministically ordered by task then harness', () => {
    const records = [
      record({ task: 'B2', harness: 'rote' }),
      record({ task: 'B1', harness: 'browser-use' }),
      record({ task: 'B1', harness: 'rote' }),
    ];
    expect(summarizeHarnessRuns(records).map((s) => `${s.task}/${s.harness}`)).toEqual([
      'B1/browser-use',
      'B1/rote',
      'B2/rote',
    ]);
  });
});

describe('buildHeadToHead', () => {
  it('compares the subject against every baseline harness per task', () => {
    const records = [
      record({ task: 'B1', harness: 'rote', input_tokens: 100, output_tokens: 0 }),
      record({ task: 'B1', harness: 'browser-use', input_tokens: 400, output_tokens: 0 }),
    ];
    const result = buildHeadToHead(records, { subject: 'rote' });
    expect(result.comparisons).toHaveLength(1);
    const [c] = result.comparisons;
    expect(c.baseline.harness).toBe('browser-use');
    expect(c.token_reduction_ratio).toBeCloseTo(0.75);
    expect(c.success_parity).toBe(true);
  });

  it('flags a broken parity when the subject succeeds less often than the baseline', () => {
    const records = [
      record({ task: 'B1', harness: 'rote', repetition: 0, outcome: 'failure' }),
      record({ task: 'B1', harness: 'rote', repetition: 1, outcome: 'success' }),
      record({ task: 'B1', harness: 'browser-use', repetition: 0, outcome: 'success' }),
      record({ task: 'B1', harness: 'browser-use', repetition: 1, outcome: 'success' }),
    ];
    const [c] = buildHeadToHead(records).comparisons;
    expect(c.success_parity).toBe(false);
  });

  it('emits no comparison for a task the subject never ran', () => {
    const records = [record({ task: 'B9', harness: 'browser-use' })];
    expect(buildHeadToHead(records, { subject: 'rote' }).comparisons).toEqual([]);
  });
});

// Builds n success records for a harness/task from an explicit list of token totals.
function runs(harness: string, task: string, tokens: readonly number[]): CompetitorRunRecord[] {
  return tokens.map((total, i) =>
    record({ harness, task, repetition: i, input_tokens: total, output_tokens: 0 }),
  );
}

// A spread of ~n token totals around center, deterministic (no RNG in the fixture).
function spread(center: number, jitter: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => center + ((i % 5) - 2) * jitter);
}

describe('bootstrapReductionInterval', () => {
  it('reports a lower bound above zero when the distributions are clearly separated', () => {
    const interval = bootstrapReductionInterval(spread(120, 10, 18), spread(400, 20, 18));
    expect(interval.point).toBeCloseTo(0.7, 1);
    expect(interval.lower).toBeGreaterThan(0.5);
    expect(interval.lower).toBeLessThanOrEqual(interval.point);
    expect(interval.upper).toBeGreaterThanOrEqual(interval.point);
  });

  it('drops the lower bound below zero when the distributions heavily overlap', () => {
    const subject = [...spread(200, 20, 15), 600, 620, 640];
    const interval = bootstrapReductionInterval(subject, spread(300, 20, 18));
    expect(interval.lower).toBeLessThan(0);
  });

  it('is deterministic for identical input (fixed seed)', () => {
    const a = bootstrapReductionInterval(spread(120, 10, 16), spread(400, 20, 16));
    const b = bootstrapReductionInterval(spread(120, 10, 16), spread(400, 20, 16));
    expect(a).toEqual(b);
  });

  it('returns an all-zero interval against an absent distribution', () => {
    expect(bootstrapReductionInterval([100], [])).toMatchObject({ point: 0, lower: 0, upper: 0 });
  });
});

describe('evaluateLaunchGate', () => {
  it('passes when parity holds and the range lower bound clears the floor with enough runs', () => {
    const records = [
      ...runs('rote', 'B1', spread(120, 10, 18)),
      ...runs('browser-use', 'B1', spread(400, 20, 18)),
    ];
    const gate = evaluateLaunchGate(buildHeadToHead(records), { minTokenReductionRatio: 0.3 });
    expect(gate.passed).toBe(true);
    expect(gate.comparisons[0]).toMatchObject({ success_parity: true, passed: true });
    expect(gate.comparisons[0].reduction.lower).toBeGreaterThan(0.3);
  });

  it('fails when the win does not survive variance even though the mean margin is positive', () => {
    const subject = [...spread(200, 20, 15), 600, 620, 640];
    const records = [
      ...runs('rote', 'B1', subject),
      ...runs('browser-use', 'B1', spread(300, 20, 18)),
    ];
    const gate = evaluateLaunchGate(buildHeadToHead(records));
    expect(gate.comparisons[0].reduction.point).toBeGreaterThan(0); // mean says "win"
    expect(gate.passed).toBe(false); // but the range lower bound does not clear zero
    expect(gate.comparisons[0].reasons.join()).toContain('lower bound');
  });

  it('refuses to certify a win from too few runs, however separated', () => {
    const records = [
      ...runs('rote', 'B1', [100, 110, 120, 130, 140]),
      ...runs('browser-use', 'B1', [400, 410, 420, 430, 440]),
    ];
    const gate = evaluateLaunchGate(buildHeadToHead(records), { minRuns: 15 });
    expect(gate.passed).toBe(false);
    expect(gate.comparisons[0].reasons.join()).toContain('insufficient successful runs');
  });

  it('never silently passes an empty head-to-head', () => {
    const gate = evaluateLaunchGate({ subject_harness: 'rote', comparisons: [] });
    expect(gate.passed).toBe(false);
  });
});

describe('renderHeadToHeadReport', () => {
  it('is deterministic and marks broken parity visibly', () => {
    const result = buildHeadToHead([
      record({ task: 'B1', harness: 'rote', input_tokens: 100, output_tokens: 0 }),
      record({ task: 'B1', harness: 'browser-use', input_tokens: 400, output_tokens: 0 }),
    ]);
    const md = renderHeadToHeadReport(result);
    expect(md).toBe(renderHeadToHeadReport(result));
    expect(md).toContain('| B1 | browser-use | 75.0% | 0.0% | 75.0% | yes |');
    expect(md).toContain('| B1 | rote | 1 | 100.0% | 100 | 1000 | 1000 | 1000 | $0.0005 |');
    expect(md).toContain('| B1 | browser-use | 1 | 100.0% | 400 | 1000 | 1000 | 1000 | $0.0020 |');
  });

  it('labels an unpriced model instead of rendering it as free', () => {
    const result = buildHeadToHead([
      record({ task: 'B1', harness: 'rote', model: 'claude-opus-4-8' }),
      record({ task: 'B1', harness: 'browser-use', model: 'some-unlisted-model' }),
    ]);
    const md = renderHeadToHeadReport(result);

    expect(result.comparisons[0]?.baseline.avg_cost_usd).toBeUndefined();
    // A $0 here would read as "the competitor is free" and flatter nobody honestly.
    expect(md).not.toContain('$0.0000');
    expect(md).toContain('price unavailable');
    // The token reduction is still reported — an unpriced model costs us the $
    // column, not the whole comparison.
    expect(result.comparisons[0]?.cost_reduction_ratio).toBeUndefined();
    expect(result.comparisons[0]?.token_reduction_ratio).toBe(0);
  });

  it('records which price table produced the $ column', () => {
    const result = buildHeadToHead([record({ harness: 'rote' }), record({ harness: 'browser-use' })]);
    expect(renderHeadToHeadReport(result)).toContain(`Prices: \`${result.prices.version}\``);
  });
});

describe('latency and cost aggregation', () => {
  const runs = (harness: string, durations: number[]) =>
    durations.map((duration_ms, i) => record({ harness, repetition: i, duration_ms }));

  it('summarizes latency as avg/p50/p95 in ms over successful runs', () => {
    const [summary] = summarizeHarnessRuns(runs('rote', [1000, 2000, 3000, 4000]));
    expect(summary?.avg_duration_ms).toBe(2500);
    expect(summary?.p50_duration_ms).toBe(2500);
    // Linear interpolation between the 3rd and 4th value: 3000 + 0.85 * 1000.
    // Close-to, not exact: the interpolation lands on 3849.9999999999995 in
    // binary floating point. Rendering rounds to 2dp, so the report is unaffected.
    expect(summary?.p95_duration_ms).toBeCloseTo(3850, 6);
  });

  it('excludes failed runs from latency and cost, as it does from tokens', () => {
    const [summary] = summarizeHarnessRuns([
      record({ harness: 'rote', repetition: 0, duration_ms: 1000 }),
      record({ harness: 'rote', repetition: 1, outcome: 'failure', duration_ms: 99_000 }),
    ]);
    expect(summary?.avg_duration_ms).toBe(1000);
    expect(summary?.p95_duration_ms).toBe(1000);
    expect(summary?.runs).toBe(2);
    // The failure still lowers the success rate the parity gate reads.
    expect(summary?.success_rate).toBe(0.5);
  });

  it('prices a run from its own model at the table rate', () => {
    // claude-opus-4-8: $5/MTok input, $25/MTok output.
    const [summary] = summarizeHarnessRuns([
      record({ harness: 'rote', input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ]);
    expect(summary?.avg_cost_usd).toBe(30);
  });

  it('reports latency and $ reductions alongside the token reduction', () => {
    const result = buildHeadToHead([
      record({ task: 'B1', harness: 'rote', input_tokens: 100, output_tokens: 0, duration_ms: 1000 }),
      record({ task: 'B1', harness: 'browser-use', input_tokens: 400, output_tokens: 0, duration_ms: 4000 }),
    ]);
    const comparison = result.comparisons[0];
    expect(comparison?.token_reduction_ratio).toBe(0.75);
    expect(comparison?.latency_reduction_ratio).toBe(0.75);
    // Same model on both sides, so $ tracks tokens exactly.
    expect(comparison?.cost_reduction_ratio).toBe(0.75);
  });

  it('honors an overriding price table so actual billed rates can be reported', () => {
    const prices = {
      version: '2026-07-15-test',
      source: 'test',
      prices: { 'claude-opus-4-8': { input_usd_per_mtok: 1, output_usd_per_mtok: 1 } },
    };
    const [summary] = summarizeHarnessRuns(
      [record({ harness: 'rote', input_tokens: 1_000_000, output_tokens: 1_000_000 })],
      prices,
    );
    expect(summary?.avg_cost_usd).toBe(2);
  });
});

describe('readCompetitorRecords', () => {
  it('accepts both a bare array and a { records } wrapper', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rote-hh-'));
    const arrayPath = join(dir, 'arr.json');
    const wrapPath = join(dir, 'wrap.json');
    await writeFile(arrayPath, JSON.stringify([record({})]), 'utf8');
    await writeFile(wrapPath, JSON.stringify({ records: [record({})] }), 'utf8');
    expect(await readCompetitorRecords(arrayPath)).toHaveLength(1);
    expect(await readCompetitorRecords(wrapPath)).toHaveLength(1);
  });
});
