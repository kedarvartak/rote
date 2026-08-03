import { buildEnvFingerprint, type RunManifest } from '@rote/core';
import { describe, expect, it } from 'vitest';
import { buildG2Report, renderG2Report, type CompetitorRunRecord } from '../src/index.js';

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
        is_successful: true,
        verify_text: task === 'B2'
          ? 'company_name=x contact_email=x tax_id=x address_line1=x city=x postal_code=x country=x phone=x'
          : 'Done',
        verify_text_visible: true,
        provider_receipts: [{ model: 'gpt-4.1-mini', usage: { prompt_tokens: 100, completion_tokens: 0 } }],
      });
    }
  }
  return { records, manifests, dumps };
}

describe('G2 report', () => {
  it('distinguishes the formal gate from the 80% catalog target', () => {
    const { records, manifests, dumps } = evidence();
    const report = buildG2Report(records, manifests, dumps, 15, 'p1-g2-fixtures-v2-b2-exact');
    expect(report.protocol_id).toBe('p1-g2-fixtures-v2-b2-exact');
    expect(report.gate_passed).toBe(true);
    expect(report.tasks.map((task) => task.clears_80_percent_target)).toEqual([true, false, true]);
    expect(report.verification_audit).toMatchObject({ rote_manifests: 45, browser_use_dumps: 45 });
  });

  it('reports a corrective B2-only protocol without relabeling it as the historical matrix', () => {
    const { records, manifests, dumps } = evidence();
    const report = buildG2Report(
      records.filter((record) => record.task === 'B2'),
      manifests.filter((manifest) => manifest.run_id.includes('-b2-')),
      dumps.filter((dump) => dump.task === 'B2'),
      15,
      'p1-g2-fixtures-v2-b2-exact',
    );
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0]).toMatchObject({ task: 'B2', clears_80_percent_target: false });
  });

  it('certifies a separately pinned Browser Use 0.13.7 paired B2 protocol', () => {
    const { records, manifests, dumps } = evidence();
    const b2Records = records.filter((record) => record.task === 'B2');
    const b2Manifests = manifests.filter((manifest) => manifest.run_id.includes('-b2-'));
    const b2Dumps = dumps.filter((dump) => dump.task === 'B2').map((dump) => ({ ...dump, browser_use_version: '0.13.7' }));
    const report = buildG2Report(
      b2Records, b2Manifests, b2Dumps, 15, 'p1-g2-fixtures-v3-b2-browser-use-0137-paired',
    );
    expect(report.browser_use_version).toBe('0.13.7');
    expect(report.tasks.map((task) => task.task)).toEqual(['B2']);
    expect(report.gate_passed).toBe(true);
    expect(renderG2Report(report)).toContain('Both harnesses ran as cold agents; this cell does not test replay or learning.');
  });

  it('rejects protocol-v2 B2 evidence that does not retain the exact oracle', () => {
    const { records, manifests, dumps } = evidence();
    dumps.find((dump) => dump.task === 'B2')!.verify_text = 'Vendor registration complete';
    expect(() => buildG2Report(records, manifests, dumps, 15, 'p1-g2-fixtures-v2-b2-exact')).toThrow(
      /does not retain the exact B2 verification oracle/,
    );
  });

  it('rejects a Browser Use version that does not match the paired protocol', () => {
    const { records, manifests, dumps } = evidence();
    expect(() => buildG2Report(
      records.filter((record) => record.task === 'B2'),
      manifests.filter((manifest) => manifest.run_id.includes('-b2-')),
      dumps.filter((dump) => dump.task === 'B2'),
      15,
      'p1-g2-fixtures-v3-b2-browser-use-0137-paired',
    )).toThrow(/requires Browser Use 0.13.7/);
  });

  it('rejects a Browser Use success without live verification', () => {
    const { records, manifests, dumps } = evidence();
    dumps[0]!.verify_text_visible = false;
    expect(() => buildG2Report(records, manifests, dumps)).toThrow(/success without conclusion and live verification/);
  });

  it('rejects Browser Use aggregates that do not reconcile to raw receipts', () => {
    const { records, manifests, dumps } = evidence();
    (dumps[0]!.provider_receipts as Array<{ usage: { prompt_tokens: number } }>)[0]!.usage.prompt_tokens = 99;
    expect(() => buildG2Report(records, manifests, dumps)).toThrow(/does not reconcile to raw provider receipts/);
  });

  it('rejects missing raw evidence identities', () => {
    const { records, manifests, dumps } = evidence();
    manifests.pop();
    expect(() => buildG2Report(records, manifests, dumps)).toThrow(/identity mismatch/);
  });
});
