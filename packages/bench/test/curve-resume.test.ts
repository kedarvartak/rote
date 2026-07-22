import { describe, expect, it } from 'vitest';
import { planCurveResume } from '../src/index.js';

function completedRun(runId: string): string {
  const zero = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 };
  return `${JSON.stringify({
    schema_version: 1,
    record_kind: 'measurement',
    protocol_id: 'p',
    task_id: 't',
    harness: 'rote',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    run_id: runId,
    repetition: 1,
    target_steps: 1,
    step_index: 1,
    source: 'planner',
    duration_ms: 1,
    duration_scope: 'agent_step',
    usage: zero,
    cumulative_usage: zero,
    provider_usage: { input_tokens: 0, output_tokens: 0 },
    step_outcome: 'failure',
    verification_passed: false,
  })}\n`;
}

describe('curve resume planning', () => {
  it('refuses to overwrite any non-empty artifact', () => {
    expect(() => planCurveResume(completedRun('run-1'), false, 'curve.jsonl')).toThrow(
      'pass --resume or choose a new path',
    );
  });

  it('validates existing JSONL and skips only completed run ids', () => {
    const plan = planCurveResume(completedRun('run-1'), true, 'curve.jsonl');
    expect([...plan.completedRunIds]).toEqual(['run-1']);
    expect(plan.initializeEmptyFile).toBe(false);
    expect(() => planCurveResume('{"partial":', true, 'curve.jsonl')).toThrow();
  });

  it('initializes only a missing artifact', () => {
    expect(planCurveResume(undefined, false, 'curve.jsonl')).toEqual({
      completedRunIds: new Set(),
      initializeEmptyFile: true,
    });
  });
});
