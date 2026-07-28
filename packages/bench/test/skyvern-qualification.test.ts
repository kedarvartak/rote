import { describe, expect, it } from 'vitest';
import { buildSkyvernQualification, renderSkyvernQualification, type SkyvernQualificationReceipt } from '../src/skyvern-qualification.js';

const mutations = ['fields-renamed', 'submit-renamed', 'wrappers', 'stale-selector-decoys', 'ambiguous-company'] as const;

function receipt(
  repetition: number,
  phase: 'cold' | 'warm' | 'drift',
  mutation: 'canonical' | typeof mutations[number],
): SkyvernQualificationReceipt {
  const artifact = {
    script_id: `s_${repetition}`,
    version: 1,
    sha256: String(repetition).repeat(64),
    cache_key_value: 'default:127.0.0.1:8092:v2',
  };
  return {
    schema_version: 1,
    protocol_id: 'skyvern-v1.0.47-b2-b5-qualification-v1',
    harness: 'skyvern',
    harness_version: '1.0.47',
    source_commit: '9fc0b2aee079ee34ae3cdb578ca346f06c733218f',
    image_index_digest: 'sha256:ad58d950f1c8cc3bc2d442228f701243b80b84494f11bbb066347ed034006e77',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    viewport: { width: 1920, height: 1080 },
    task: 'B2',
    phase,
    mutation,
    repetition,
    initial_url: 'http://127.0.0.1:8092/b2-vendor-form.html',
    verify_text: 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148',
    workflow: { workflow_permanent_id: `wpid_${repetition}` },
    run_id: `wr_${phase}_${mutation}_${repetition}`,
    status: 'completed',
    harness_success: true,
    exact_live_verification: true,
    outcome: phase === 'cold' ? 'cold_success' : 'ai_fallback_success',
    ai_fallback_triggered: phase !== 'cold',
    script_id_used: phase === 'cold' ? null : artifact.script_id,
    script_revision_id_used: phase === 'cold' ? null : `sr_${repetition}`,
    artifact_before: phase === 'cold' ? null : artifact,
    artifact_after: artifact,
    artifact_changed: phase === 'cold',
    usage: { input_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 1 },
    runtime_usage: { input_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 1 },
    regeneration_usage: { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 },
    llm_call_aggregates: [{ prompt_name: 'diagnostic', input_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 1 }],
    raw_provider_receipts: [],
    provider_receipts_complete: false,
    duration_ms: 100,
    destructive_dispatches: [],
    independent_audit: [{ kind: 'submission' }],
    failure_reason: null,
    raw_directory: `bench-out/raw/${repetition}/${phase}-${mutation}`,
  };
}

function completeReceipts(): SkyvernQualificationReceipt[] {
  return [1, 2, 3].flatMap((repetition) => [
    receipt(repetition, 'cold', 'canonical'),
    receipt(repetition, 'warm', 'canonical'),
    ...mutations.map((mutation) => receipt(repetition, 'drift', mutation)),
  ]);
}

describe('Skyvern qualification audit', () => {
  it('stops token and cost certification when only aggregate telemetry is available', () => {
    const { summary, records } = buildSkyvernQualification(completeReceipts());
    expect(summary.complete_paired_repetitions).toBe(3);
    expect(summary.cold_exact_successes).toBe(3);
    expect(summary.warm_drift_exact_successes).toBe(18);
    expect(summary.ai_fallback_attempts).toBe(18);
    expect(summary.zero_llm_replay_attempts).toBe(0);
    expect(summary.certification_eligible).toBe(false);
    expect(summary.disqualifications).toEqual([
      'raw provider receipts are incomplete for 21/21 attempts; token and cost ranking prohibited',
      'aggregate runtime telemetry cannot attribute generated replay, repair, and AI-fallback usage separately',
    ]);
    expect(records.every((record) => record.phase !== undefined)).toBe(true);
    expect(renderSkyvernQualification(summary)).toContain('aggregate log telemetry');
  });

  it('does not count an observed pair as exact when any paired replay fails', () => {
    const receipts = completeReceipts();
    const failed = receipts.find((value) => value.repetition === 1 && value.mutation === 'wrappers')!;
    failed.harness_success = false;
    failed.exact_live_verification = false;
    failed.outcome = 'failure';
    const { summary } = buildSkyvernQualification(receipts);
    expect(summary.complete_paired_repetitions).toBe(2);
    expect(summary.certification_eligible).toBe(false);
  });

  it('rejects a harness success hidden behind a successful outcome when the exact oracle failed', () => {
    const invalid = receipt(1, 'cold', 'canonical');
    invalid.exact_live_verification = false;
    expect(() => buildSkyvernQualification([invalid])).toThrow(/hides failed independent verification/);
  });

  it('rejects warm evidence without the generated script actually used', () => {
    const invalid = receipt(1, 'warm', 'canonical');
    invalid.script_id_used = null;
    expect(() => buildSkyvernQualification([invalid])).toThrow(/no generated script identity/);
  });
});
