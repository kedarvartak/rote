import { describe, expect, it } from 'vitest';
import { buildB5Report, type B5MutationRecord } from '../src/index.js';

const recoverable = ['fields-renamed', 'submit-renamed', 'wrappers', 'stale-selector-decoys'];

function records(): B5MutationRecord[] {
  return [...recoverable.map((mutation) => ({ mutation, expectation: 'recover' as const })),
    { mutation: 'ambiguous-company', expectation: 'fail_closed' as const }]
    .flatMap(({ mutation, expectation }) => Array.from({ length: 15 }, (_, index) => ({
      protocol_id: 'p1-b5-b2-drift-v1' as const,
      mutation,
      expectation,
      repetition: index + 1,
      outcome: expectation === 'recover' ? 'repaired_success' as const : 'detected_fallback' as const,
      repaired_steps: expectation === 'recover' ? 2 : 0,
      logical_tokens: 0,
      duration_ms: 20,
      exact_live_verification: expectation === 'recover',
    })));
}

function cold() {
  return Array.from({ length: 15 }, (_, index) => ({
    harness: 'rote', task: 'B2', model: 'gpt-4.1-mini', repetition: index + 1,
    outcome: 'success', input_tokens: 8000, cache_read_tokens: 0,
    cache_write_tokens: 0, output_tokens: 400, duration_ms: 20_000,
    cache_adjusted: true, config_notes: 'corrective exact B2',
  }));
}

describe('B5 drift report', () => {
  it('certifies repaired exact outcomes and fail-closed ambiguity against cold cost', () => {
    expect(buildB5Report(records(), cold())).toMatchObject({
      certified: true,
      drift_recovery_rate: 1,
      silent_failure_rate: 0,
      fail_closed_rate: 1,
      mean_repair_cost_ratio: 0,
      attempts: 75,
    });
  });

  it('fails certification when a drifted replay is silently wrong', () => {
    const input = records();
    input[0] = { ...input[0]!, outcome: 'silent_failure', exact_live_verification: false };
    const report = buildB5Report(input, cold());

    expect(report.certified).toBe(false);
    expect(report.silent_failure_rate).toBeGreaterThan(0);
  });
});
