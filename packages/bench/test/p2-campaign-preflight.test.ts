import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertP2CampaignPreflight,
  P2CampaignPreflightError,
  parseP2CampaignDryRun,
  parseP2CampaignProtocol,
  writeP2CampaignPreflight,
} from '../src/index.js';

const protocolPath = fileURLToPath(new URL('../../../scripts/bench/p2-campaign/protocol.json', import.meta.url));
const dryRunPath = fileURLToPath(new URL('../../../scripts/bench/p2-campaign/dry-run.json', import.meta.url));

async function fixture() {
  const protocol = parseP2CampaignProtocol(JSON.parse(await readFile(protocolPath, 'utf8')));
  const rows = parseP2CampaignDryRun(JSON.parse(await readFile(dryRunPath, 'utf8')));
  return { protocol, rows };
}

describe('P2 provider-billed campaign preflight', () => {
  it('accepts every frozen campaign row without a provider call', async () => {
    const { protocol, rows } = await fixture();
    expect(() => assertP2CampaignPreflight(protocol, rows)).not.toThrow();

    const out = join(await mkdtemp(join(tmpdir(), 'rote-p2-campaign-')), 'report.json');
    const report = await writeP2CampaignPreflight(protocolPath, dryRunPath, out);
    expect(report).toEqual({
      protocol_id: 'p2-provider-exit-campaign-v1',
      preflight: 'passed',
      cells: ['t0-distillation-repeat', 't2-novel-known-site', 'routing-predictor-real-page', 'b4-long-run-economics'],
      provider_calls: 0,
    });
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(report);
  });

  it.each([
    ['campaign_row_missing', (rows: Awaited<ReturnType<typeof fixture>>['rows']) => rows.slice(1)],
    ['campaign_row_duplicate', (rows: Awaited<ReturnType<typeof fixture>>['rows']) => [...rows, rows[0]!]],
    ['usage_bucket_missing', (rows: Awaited<ReturnType<typeof fixture>>['rows']) => rows.map((row, index) => index === 0
      ? { ...row, usage_buckets: row.usage_buckets.filter((bucket) => bucket !== 'cache_write_tokens') } : row)],
    ['source_tag_missing', (rows: Awaited<ReturnType<typeof fixture>>['rows']) => rows.map((row, index) => index === 0
      ? { ...row, source_tags: row.source_tags.filter((tag) => tag !== 'matcher') } : row)],
    ['pricing_unavailable', (rows: Awaited<ReturnType<typeof fixture>>['rows']) => rows.map((row, index) => index === 0
      ? { ...row, pricing_table_loaded: false } : row)],
    ['reset_evidence_mismatch', (rows: Awaited<ReturnType<typeof fixture>>['rows']) => rows.map((row, index) => index === 0
      ? { ...row, reset_evidence: { ...row.reset_evidence, command: 'wrong-reset' } } : row)],
    ['oracle_evidence_mismatch', (rows: Awaited<ReturnType<typeof fixture>>['rows']) => rows.map((row, index) => index === 0
      ? { ...row, oracle_evidence: { ...row.oracle_evidence, command: 'wrong-oracle' } } : row)],
  ] as const)('fails closed as %s when static evidence is incomplete', async (classification, mutate) => {
    const { protocol, rows } = await fixture();
    expect(() => assertP2CampaignPreflight(protocol, mutate(rows))).toThrow(expect.objectContaining({
      name: 'P2CampaignPreflightError',
      classification,
      cellId: 't0-distillation-repeat',
    } satisfies Partial<P2CampaignPreflightError>));
  });

  it('rejects UI-only oracle classes, missing routing telemetry, and short B4 cells in the frozen protocol', async () => {
    const { protocol } = await fixture();
    const invalid = {
      ...protocol,
      cells: protocol.cells.map((cell) => {
        if (cell.gate === 't2') return { ...cell, oracle: { ...cell.oracle, kind: 'ui_text' } };
        if (cell.gate === 'routing') return { ...cell, required_source_tags: ['planner', 'route'] };
        if (cell.gate === 'b4') return { ...cell, minimum_transitions: 49 };
        return cell;
      }),
    };
    expect(() => parseP2CampaignProtocol(invalid)).toThrow();
  });
});
