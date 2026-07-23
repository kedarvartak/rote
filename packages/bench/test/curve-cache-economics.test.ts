import { describe, expect, it } from 'vitest';
import { buildCurveCacheEconomics, CurveStepRecordSchema } from '../src/index.js';

type Record = ReturnType<typeof CurveStepRecordSchema.parse>;

function records(harness: string, protocol: string, cacheRead: number): Record[] {
  const rows: Record[] = [];
  for (let repetition = 1; repetition <= 15; repetition += 1) {
    for (const [task, steps] of [['short', 10], ['long', 20]] as const) {
      const logical = 1000 + steps * (harness === 'browser-use' ? 200 : 100) + repetition;
      const usage = {
        input_tokens: logical - cacheRead,
        cache_read_tokens: cacheRead,
        cache_write_tokens: 0,
        output_tokens: 10,
      };
      rows.push(CurveStepRecordSchema.parse({
        schema_version: 1, protocol_id: protocol, task_id: task, harness,
        provider: 'openai', model: 'gpt-4.1-mini', run_id: `${protocol}-${harness}-${task}-${repetition}`,
        repetition, target_steps: steps, step_index: 1, source: 'planner', duration_ms: 100,
        duration_scope: 'agent_step', usage, cumulative_usage: usage, record_kind: 'measurement',
        provider_usage: { input_tokens: logical, output_tokens: 10 }, step_outcome: 'success', verification_passed: true,
      }));
    }
  }
  return rows;
}

describe('curve cache economics', () => {
  it('certifies billed savings without relabeling logical input', () => {
    const before = records('rote', 'p', 0);
    const after = records('rote', 'p-cache', 800);
    const baseline = records('browser-use', 'p', 500);
    const report = buildCurveCacheEconomics(before, after, baseline, { subjectProtocolSuffix: '-cache' });

    expect(report.cells).toHaveLength(2);
    expect(report.cells[0]!.after.mean_logical_input).toBe(report.cells[0]!.before.mean_logical_input);
    expect(report.cells[0]!.after.mean_cache_read).toBe(800);
    expect(report.cells[0]!.after_vs_before_cost_reduction.lower).toBeGreaterThan(0);
  });

  it('rejects an unversioned optimized matrix', () => {
    expect(() => buildCurveCacheEconomics(
      records('rote', 'p', 0), records('rote', 'p', 800), records('browser-use', 'p', 500),
      { subjectProtocolSuffix: '-cache' },
    )).toThrow('does not match expected');
  });
});
