import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMagnitudeQualification, type MagnitudeQualificationReceipt } from '../src/index.js';

function receipt(overrides: Partial<MagnitudeQualificationReceipt> = {}): MagnitudeQualificationReceipt {
  return {
    schema_version: 1,
    protocol_id: 'magnitude-core-v0.3.1-b2-qualification-v1',
    harness: 'magnitude-core', harness_version: '0.3.1',
    package_integrity: 'sha512-kfwfc8D4qo1JMcROhXRgPS1FTXPbtQnI8tHGJ2AXMDdUZWiD8+VHgHHBJcss0s/PqSkDmaaj4XOKzK0+iSwx0w==',
    package_shasum: 'c21a57a282a27058e146923b2b9a46bdbaa79779',
    npm_git_head: 'f1b587c4173d8242bdb551991de54e70c4d2faf3',
    provider: 'openai', model: 'gpt-4.1-mini', viewport: { width: 1920, height: 1080 },
    task: 'B2', phase: 'cold', mutation: 'canonical', attempt: 1,
    initial_url: 'http://127.0.0.1:8094/b2-vendor-form.html',
    verify_text: 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148',
    harness_success: false, exact_live_verification: false, outcome: 'timeout',
    aggregate_usage: { input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 10 },
    aggregate_usage_events: [{ inputTokens: 100, outputTokens: 10 }],
    raw_provider_receipts: [], provider_receipts_complete: false,
    duration_ms: 90_000, action_count: 2, magnitude_actions: [], observed_body_text: '',
    final_url: 'http://127.0.0.1:8094/b2-vendor-form.html', error: 'attempt exceeded frozen timeout',
    started_at: '2026-08-04T00:00:00.000Z', ended_at: '2026-08-04T00:01:30.000Z',
    ...overrides,
  };
}

describe('Magnitude qualification', () => {
  it('uses canonical corrected B2 without a vision-specific task rewrite', async () => {
    const protocol = JSON.parse(await readFile(resolve('../../scripts/bench/magnitude/protocol.json'), 'utf8'));
    const tasks = JSON.parse(await readFile(resolve('../../scripts/bench/headhead/tasks.json'), 'utf8'));
    const b2 = tasks.tasks.find((task: { id: string }) => task.id === 'B2');
    expect(protocol.task_prompt).toBe(b2.prompt);
    expect(protocol.verify_text).toBe(b2.verify_text);
    expect(protocol.model).toBe(tasks.model);
    expect(protocol.viewport).toEqual(tasks.viewport);
  });

  it('stops before certification when bounded attempts time out without raw receipts', () => {
    const input = Array.from({ length: 6 }, (_, index) => receipt({ attempt: index + 1 }));
    const { summary, records } = buildMagnitudeQualification(input);
    expect(summary).toMatchObject({
      certification_eligible: false, decision: 'stop_before_certification',
      cold_attempts: 6, cold_exact_successes: 0, cold_harness_conclusions: 0,
      timeouts: 6, observed_silent_failures: 0,
      complete_raw_provider_receipt_sets: 0, aggregate_usage_attempts: 6,
      diagnostic_records: 6, b5_attempts: 0,
    });
    expect(summary.disqualifications).toHaveLength(2);
    expect(records).toHaveLength(6);
    expect(records.every((record) => record.outcome === 'failure')).toBe(true);
  });

  it('qualifies only three exact attempts with complete non-empty raw receipts', () => {
    const input = Array.from({ length: 3 }, (_, index) => receipt({
      attempt: index + 1,
      harness_success: true,
      exact_live_verification: true,
      outcome: 'exact_success',
      raw_provider_receipts: [{
        provider: 'openai', model: 'gpt-4.1-mini', usage: { input_tokens: 100, output_tokens: 10 },
      }],
      provider_receipts_complete: true,
    }));
    expect(buildMagnitudeQualification(input).summary).toMatchObject({
      certification_eligible: true, decision: 'qualify_for_certification', disqualifications: [],
    });
  });

  it('rejects a complete receipt claim that does not reconcile to aggregate usage', () => {
    expect(() => buildMagnitudeQualification([receipt({
      provider_receipts_complete: true,
      raw_provider_receipts: [{
        provider: 'openai', model: 'gpt-4.1-mini', usage: { input_tokens: 99, output_tokens: 10 },
      }],
    })])).toThrow(/does not reconcile to raw provider receipts/);
  });

  it('rejects a harness-success/oracle-failure hidden behind another outcome', () => {
    expect(() => buildMagnitudeQualification([
      receipt({ harness_success: true, exact_live_verification: false, outcome: 'failure' }),
    ])).toThrow(/hides failed independent verification/);
  });

  it('does not turn missing aggregate usage into a zero-valued record', () => {
    const { summary, records } = buildMagnitudeQualification([
      receipt({ aggregate_usage: null, aggregate_usage_events: null, duration_ms: null }),
    ]);
    expect(records).toEqual([]);
    expect(summary.diagnostic_records).toBe(0);
  });
});
