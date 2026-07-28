import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStagehandQualification, type StagehandQualificationReceipt } from '../src/index.js';

function receipt(overrides: Partial<StagehandQualificationReceipt>): StagehandQualificationReceipt {
  const exact = overrides.exact_live_verification ?? true;
  return {
    schema_version: 1,
    protocol_id: 'stagehand-v3.7.1-b2-b5-qualification-v1',
    harness: 'stagehand', harness_version: '3.7.1',
    package_integrity: 'sha512-vAuYSZWIhh3d76BxwppNVE3dB0ztEBLBi85G6TWulZNiebdWptNoANOMuprOB/cw5dE+80b/ZZQo4G33Pc9i6w==',
    provider: 'openai', model: 'openai/gpt-4.1-mini', viewport: { width: 1920, height: 1080 },
    task: 'B2', phase: 'cold', mutation: 'canonical', repetition: 1,
    initial_url: 'http://127.0.0.1:8091/b2-vendor-form.html',
    verify_text: 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148',
    harness_success: true, exact_live_verification: exact,
    outcome: exact ? 'cold_success' : 'verification_failure',
    cache_hit: false, cache_updated: false, replay_failed: false,
    cache_identity_before: '0'.repeat(64), cache_identity_after: '1'.repeat(64),
    usage: { input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 10 },
    stagehand_metrics: { totalPromptTokens: 100 }, stagehand_result_usage: null,
    raw_provider_receipts: [], provider_receipts_complete: false,
    duration_ms: 100, action_count: 1, conclusion: 'done', observed_body_text: '',
    stagehand_actions: [], error: null, cache_logs: [],
    ...overrides,
  };
}

function evidence(): StagehandQualificationReceipt[] {
  const cold = Array.from({ length: 6 }, (_, index) => receipt({
    repetition: index + 1,
    exact_live_verification: index === 0,
    outcome: index === 0 ? 'cold_success' : 'verification_failure',
  }));
  const cells: Array<[StagehandQualificationReceipt['phase'], StagehandQualificationReceipt['mutation'], boolean]> = [
    ['warm', 'canonical', true], ['drift', 'fields-renamed', true], ['drift', 'submit-renamed', true],
    ['drift', 'wrappers', true], ['drift', 'stale-selector-decoys', false], ['drift', 'ambiguous-company', false],
  ];
  return [...cold, ...cells.map(([phase, mutation, exact]) => receipt({
    phase, mutation, exact_live_verification: exact,
    outcome: exact ? 'cached_success' : 'silent_failure', cache_hit: true,
    provider_receipts_complete: true, usage: { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 },
  }))];
}

describe('Stagehand qualification', () => {
  it('uses the canonical B2 task and exact oracle without a Stagehand-specific rewrite', async () => {
    const protocol = JSON.parse(await readFile(resolve('../../scripts/bench/stagehand/protocol.json'), 'utf8'));
    const tasks = JSON.parse(await readFile(resolve('../../scripts/bench/headhead/tasks.json'), 'utf8'));
    const b2 = tasks.tasks.find((task: { id: string }) => task.id === 'B2');

    expect(protocol.task_prompt).toBe(b2.prompt);
    expect(protocol.verify_text).toBe(b2.verify_text);
    expect(protocol.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('stops before certification when exact cold parity, safety, and receipts fail', () => {
    const { summary, records } = buildStagehandQualification(evidence());

    expect(summary).toMatchObject({
      certification_eligible: false, decision: 'stop_before_certification',
      cold_attempts: 6, cold_exact_successes: 1, cold_harness_conclusions: 6,
      complete_paired_repetitions: 1, drift_attempts: 5, drift_exact_successes: 3,
      observed_silent_failures: 7, cold_receipts_complete: 0,
      warm_drift_receipts_complete: 6, warm_drift_attempts: 6,
    });
    expect(records).toHaveLength(12);
    expect(records.filter((record) => record.outcome === 'failure')).toHaveLength(7);
  });

  it('qualifies only when three complete exact pairs and receipts have no disqualification', () => {
    const cells: Array<[StagehandQualificationReceipt['phase'], StagehandQualificationReceipt['mutation']]> = [
      ['warm', 'canonical'], ['drift', 'fields-renamed'], ['drift', 'submit-renamed'],
      ['drift', 'wrappers'], ['drift', 'stale-selector-decoys'], ['drift', 'ambiguous-company'],
    ];
    const input = Array.from({ length: 3 }, (_, index) => {
      const repetition = index + 1;
      return [
        receipt({ repetition, provider_receipts_complete: true }),
        ...cells.map(([phase, mutation]) => receipt({
          phase, mutation, repetition, cache_hit: true, outcome: 'cached_success', provider_receipts_complete: true,
        })),
      ];
    }).flat();

    expect(buildStagehandQualification(input).summary).toMatchObject({
      certification_eligible: true,
      decision: 'qualify_for_certification',
      complete_paired_repetitions: 3,
      disqualifications: [],
    });
  });

  it('rejects a harness success whose oracle failure is mislabeled as success', () => {
    const input = evidence();
    input[1] = { ...input[1]!, outcome: 'cold_success' };

    expect(() => buildStagehandQualification(input)).toThrow(/hides failed independent verification/);
  });
});
