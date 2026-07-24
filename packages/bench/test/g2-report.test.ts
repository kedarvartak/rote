import { buildEnvFingerprint, type RunManifest } from '@rote/core';
import { describe, expect, it } from 'vitest';
import { buildG2Report, type CompetitorRunRecord } from '../src/index.js';

const fingerprint = buildEnvFingerprint({
  tool_inventory: [{ name: 'browser.click', schema_hash: 'abc' }],
  target_identity: 'fixture',
  surface_versions: {},
});

function evidence() {
  const records: CompetitorRunRecord[] = [];
  const manifests: RunManifest[] = [];
  const dumps: Array<Record<string, unknown>> = [];
  for (const [task, roteTokens] of [['B1', 10], ['B2', 30], ['B3', 5]] as const) {
    for (let repetition = 1; repetition <= 15; repetition += 1) {
      records.push({
        harness: 'rote', task, phase: 'cold', repetition, outcome: 'success',
        input_tokens: roteTokens, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0,
        duration_ms: 50, model: 'gpt-4.1-mini', cache_adjusted: true,
      }, {
        harness: 'browser-use', task, phase: 'cold', repetition, outcome: 'success',
        input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0,
        duration_ms: 100, model: 'gpt-4.1-mini', cache_adjusted: true,
      });
      manifests.push({
        run_id: `g2-rote-${task.toLowerCase()}-r${String(repetition).padStart(2, '0')}`,
        task_spec: task,
        env_fingerprint: fingerprint,
        outcome: 'success',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:00.050Z',
        token_usage: [{ source: 'planner', input_tokens: roteTokens, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 }],
      });
      dumps.push({
        task, repetition, outcome: 'success', input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0,
        output_tokens: 0, duration_ms: 100, browser_use_version: '0.13.6', provider: 'openai', model: 'gpt-4.1-mini',
        is_successful: true, verify_text_visible: true,
        provider_receipts: [{ model: 'gpt-4.1-mini', usage: { prompt_tokens: 100 } }],
      });
    }
  }
  return { records, manifests, dumps };
}

describe('G2 report', () => {
  it('distinguishes the formal gate from the 80% catalog target', () => {
    const { records, manifests, dumps } = evidence();
    const report = buildG2Report(records, manifests, dumps);
    expect(report.gate_passed).toBe(true);
    expect(report.tasks.map((task) => task.clears_80_percent_target)).toEqual([true, false, true]);
    expect(report.verification_audit).toMatchObject({ rote_manifests: 45, browser_use_dumps: 45 });
  });

  it('rejects a Browser Use success without live verification', () => {
    const { records, manifests, dumps } = evidence();
    dumps[0]!.verify_text_visible = false;
    expect(() => buildG2Report(records, manifests, dumps)).toThrow(/success without conclusion and live verification/);
  });

  it('rejects missing raw evidence identities', () => {
    const { records, manifests, dumps } = evidence();
    manifests.pop();
    expect(() => buildG2Report(records, manifests, dumps)).toThrow(/identity mismatch/);
  });
});
