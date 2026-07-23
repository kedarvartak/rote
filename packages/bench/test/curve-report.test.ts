import { describe, expect, it } from 'vitest';
import { buildCurveReport, CurveStepRecordSchema, renderCurveReport, renderCurveSvg } from '../src/index.js';

type RecordInput = Parameters<typeof CurveStepRecordSchema.parse>[0];

function records(harness: string, baseline = false): ReturnType<typeof CurveStepRecordSchema.parse>[] {
  const rows: ReturnType<typeof CurveStepRecordSchema.parse>[] = [];
  for (let repetition = 1; repetition <= 15; repetition += 1) {
    for (const [task, steps] of [['short', 10], ['long', 20]] as const) {
      const logical = baseline ? 1000 + steps * 200 : 1000 + steps * 100;
      const usage = { input_tokens: logical + repetition, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 10 };
      const row: RecordInput = {
        schema_version: 1,
        protocol_id: 'curve-v1',
        task_id: task,
        harness,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        run_id: `${harness}-${task}-${repetition}`,
        repetition,
        target_steps: steps,
        step_index: 1,
        source: 'planner',
        duration_ms: 100,
        duration_scope: 'agent_step',
        usage,
        cumulative_usage: usage,
        record_kind: 'measurement',
        provider_usage: { prompt_tokens: logical + repetition, completion_tokens: 10 },
        step_outcome: 'success',
        verification_passed: true,
        observation: { mode: steps === 10 ? 'bootstrap' : 'diff', rendered_chars: steps === 10 ? 1000 : 100, approximate_tokens: steps === 10 ? 250 : 25 },
      };
      rows.push(CurveStepRecordSchema.parse(row));
    }
  }
  return rows;
}

describe('G1 curve report', () => {
  it('certifies slower growth from complete verified matched repetitions', () => {
    const summary = buildCurveReport(records('rote'), records('browser-use', true), { slopeReductionFloor: 0.4 });
    expect(summary.complete_matched_repetitions).toBe(15);
    expect(summary.slope.reduction.point).toBeCloseTo(0.5, 3);
    expect(summary.slope.passed).toBe(true);
    expect(summary.cells).toHaveLength(2);
    expect(renderCurveReport(summary)).toContain('**Result: PASS.**');
    expect(renderCurveSvg(summary)).toContain('Cumulative logical input tokens');
  });

  it('is byte-stable under the fixed bootstrap seed', () => {
    const first = buildCurveReport(records('rote'), records('browser-use', true));
    const second = buildCurveReport(records('rote'), records('browser-use', true));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('rejects success whose independent verification did not pass', () => {
    const subject = records('rote');
    const invalid = { ...subject[0]!, verification_passed: false };
    expect(() => buildCurveReport([invalid, ...subject.slice(1)], records('browser-use', true))).toThrow(
      'reports success without passed terminal verification',
    );
  });

  it('rejects fewer than fifteen complete successful matched repetitions', () => {
    const subject = records('rote').filter((row) => row.repetition < 15);
    expect(() => buildCurveReport(subject, records('browser-use', true))).toThrow('fewer than 15 successful runs');
  });
});
