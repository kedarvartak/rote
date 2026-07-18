import { describe, expect, it } from 'vitest';
import { roteCurveRecordsFromRun } from '../src/index.js';

function step(index: number, overrides: Record<string, unknown> = {}) {
  return {
    step: index,
    action: { kind: index === 1 ? 'done' : 'click' },
    observation: {
      mode: index === 0 ? 'bootstrap' : 'diff',
      text: index === 0 ? 'grounded bootstrap' : '~ checkbox checked=true',
      approxTokens: index === 0 ? 10_395 : 6,
    },
    usage: {
      source: 'planner',
      input_tokens: 500,
      cache_read_tokens: 700,
      cache_write_tokens: 0,
      output_tokens: 40,
    },
    providerReceipt: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      usage: { input_tokens: 1200, input_tokens_details: { cached_tokens: 700 }, output_tokens: 40 },
    },
    durationMs: 1000 + index,
    ...overrides,
  } as const;
}

describe('Rote G1 curve records', () => {
  it('preserves provider receipts, observations, cache buckets, and final verification', () => {
    const records = roteCurveRecordsFromRun({
      protocolId: 'p1-g1-wordpress-v1-openai-instrument-probe',
      taskId: 'WP-N07',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      runId: 'rote-WP-N07-r01',
      repetition: 1,
      targetSteps: 7,
      outcome: 'success',
      steps: [step(0), step(1)],
    });

    expect(records[0]).toEqual(expect.objectContaining({
      harness: 'rote',
      step_index: 1,
      agent_step_index: 1,
      observation: { mode: 'bootstrap', rendered_chars: 18, approximate_tokens: 10395 },
      usage: { input_tokens: 500, cache_read_tokens: 700, cache_write_tokens: 0, output_tokens: 40 },
      provider_usage: expect.objectContaining({ input_tokens: 1200 }),
    }));
    expect(records[1]).toEqual(expect.objectContaining({
      step_outcome: 'success',
      verification_passed: true,
      observation: { mode: 'diff', rendered_chars: 23, approximate_tokens: 6 },
      cumulative_usage: { input_tokens: 1000, cache_read_tokens: 1400, cache_write_tokens: 0, output_tokens: 80 },
    }));
  });

  it('records output-repair calls rather than hiding spend above target complexity', () => {
    const repairUsage = {
      source: 'repair' as const,
      input_tokens: 200,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 20,
    };
    const repairReceipt = {
      provider: 'openai' as const,
      model: 'gpt-4.1-mini',
      usage: { input_tokens: 200, output_tokens: 20 },
    };
    const records = roteCurveRecordsFromRun({
      protocolId: 'p', taskId: 't', provider: 'openai', model: 'gpt-4.1-mini',
      runId: 'run', repetition: 1, targetSteps: 1, outcome: 'failure',
      steps: [step(0, { repairUsage: [repairUsage], repairProviderReceipts: [repairReceipt] })],
    });

    expect(records).toHaveLength(2);
    expect(records[1]).toEqual(expect.objectContaining({
      step_index: 2,
      target_steps: 1,
      source: 'repair',
      step_outcome: 'failure',
      verification_passed: false,
    }));
  });

  it('fails when any provider receipt is missing or belongs to another model', () => {
    const base = {
      protocolId: 'p', taskId: 't', provider: 'openai' as const, model: 'gpt-4.1-mini',
      runId: 'run', repetition: 1, targetSteps: 1, outcome: 'failure' as const,
    };
    expect(() => roteCurveRecordsFromRun({ ...base, steps: [step(0, { providerReceipt: undefined })] }))
      .toThrow('1 calls but 0 provider receipts');
    expect(() => roteCurveRecordsFromRun({
      ...base,
      steps: [step(0, { providerReceipt: { provider: 'openai', model: 'other', usage: { input_tokens: 1 } } })],
    })).toThrow('expected openai/gpt-4.1-mini');
  });
});
