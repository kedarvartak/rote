import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditT0Campaign, renderT0CampaignAudit, writeT0CampaignAudit, type T0CampaignRecord } from '../src/index.js';

const usage = (source: 'planner', input: number, output = 10) => ({
  source,
  input_tokens: input,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  output_tokens: output,
});

function rows(): T0CampaignRecord[] {
  return Array.from({ length: 15 }, (_, index) => [
    {
      protocol_id: 'p2-provider-exit-campaign-v1' as const,
      cell_id: 't0-distillation-repeat' as const,
      repetition: index + 1,
      phase: 'cold' as const,
      agent_concluded: true,
      exact_authoritative_verification: true,
      source_tags: ['planner', 'verify'] as const,
      usage: [usage('planner', 1_000, 10_000)],
      duration_ms: 1_000,
      cost_usd: 1,
      pricing_table: 'default:2026-07-15',
      distill_duration_ms: 0,
      matcher_duration_ms: 0,
    },
    {
      protocol_id: 'p2-provider-exit-campaign-v1' as const,
      cell_id: 't0-distillation-repeat' as const,
      repetition: index + 1,
      phase: 'warm' as const,
      agent_concluded: true,
      exact_authoritative_verification: true,
      source_tags: ['distill', 'matcher', 'verify'] as const,
      usage: [],
      duration_ms: 250,
      cost_usd: 0,
      pricing_table: 'default:2026-07-15',
      distill_duration_ms: 20,
      matcher_duration_ms: 5,
    },
  ]).flat();
}

describe('T0 campaign audit', () => {
  it('certifies 15 exact pairs with seeded token, cost, and latency intervals', () => {
    const audit = auditT0Campaign(rows(), { seed: 42, resamples: 500 });
    expect(audit).toEqual(expect.objectContaining({
      repetitions: 15,
      successful_pairs: 15,
      success_parity: true,
      certifiable: true,
      passed: true,
      mean_distill_duration_ms: 20,
      mean_matcher_duration_ms: 5,
    }));
    expect(audit.logical_input_reduction).toEqual(expect.objectContaining({ point: 1, lower: 1, upper: 1 }));
    expect(audit.cost_reduction).toEqual(expect.objectContaining({ point: 1 }));
    expect(audit.latency_reduction).toEqual(expect.objectContaining({ point: 0.75 }));
    expect(renderT0CampaignAudit(audit)).toContain('T0 automated-distillation campaign — PASS');
  });

  it('uses logical input only, so output tokens cannot fabricate a worse T0 result', () => {
    const audit = auditT0Campaign(rows(), { seed: 42, resamples: 100 });
    expect(audit.logical_input_reduction?.point).toBe(1);
  });

  it('writes reproducible Markdown and JSON audit artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rote-t0-audit-'));
    try {
      const records = join(root, 'records.json');
      const markdown = join(root, 'evidence', 'report.md');
      const summary = join(root, 'evidence', 'summary.json');
      await writeFile(records, JSON.stringify(rows()), 'utf8');
      await expect(writeT0CampaignAudit(records, { markdown, summary })).resolves.toEqual(expect.objectContaining({ passed: true }));
      await expect(readFile(markdown, 'utf8')).resolves.toContain('T0 automated-distillation campaign — PASS');
      await expect(readFile(summary, 'utf8')).resolves.toContain('"successful_pairs": 15');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a failed pair in parity counts and refuses to estimate a win from its short transcript', () => {
    const value = rows();
    value[1] = { ...value[1]!, agent_concluded: false, fallback_reason: 'contract mismatch' };
    const audit = auditT0Campaign(value);
    expect(audit).toEqual(expect.objectContaining({
      repetitions: 15,
      successful_pairs: 14,
      cold_successes: 15,
      warm_successes: 14,
      success_parity: false,
      certifiable: false,
      passed: false,
    }));
    expect(audit.logical_input_reduction).toBeUndefined();
    expect(renderT0CampaignAudit(audit)).toContain('NOT CERTIFIABLE');
  });

  it.each(['missing', 'duplicate', 'source', 'pricing', 'unattributed'] as const)('fails closed on %s campaign evidence', (kind) => {
    const value = rows();
    if (kind === 'missing') value.pop();
    if (kind === 'duplicate') value.push(value[0]!);
    if (kind === 'source') value[1] = { ...value[1]!, source_tags: ['distill', 'verify'] };
    if (kind === 'pricing') value[1] = { ...value[1]!, pricing_table: 'different' };
    if (kind === 'unattributed') value[0] = { ...value[0]!, source_tags: ['verify'] };
    expect(() => auditT0Campaign(value)).toThrow();
  });
});
