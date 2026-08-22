import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSiteMemoryStore } from '@rote/site-memory';
import { formatMemoryInspection, formatMemoryList, inspectMemory, listMemoryPartitions, main } from '../src/index.js';

// `rote memory` inspects tier-2 site memory. The store is value-free by
// construction; this suite pins that the inspection prints identity fields
// only and that the brief preview matches what `rote run` would render.

const FP = 'f'.repeat(64);
const at = '2026-08-22T00:00:00.000Z';
const common = (id: string) => ({ version: 1 as const, record_id: id, fingerprint_hash: FP, observed_at: at, run_id: 'run-1', source: 'observed' as const, confidence: 1 });

const records = [
  { ...common('r1'), kind: 'selector_map' as const, page_key: 'a'.repeat(16), stable_id: 'v2:aaaaaaaaaaaaaaaa', role: 'textbox', name: 'Company name', selector: '#company-name', strategy: 'stable-id' },
  { ...common('r2'), kind: 'settle_prior' as const, page_key: 'a'.repeat(16), action_kind: 'fill', samples: 3, p50_ms: 80, p90_ms: 120, max_ms: 130 },
  { ...common('r3'), kind: 'quirk' as const, page_key: 'a'.repeat(16), code: 'enter_inserts_newline' as const, stable_id: 'v2:aaaaaaaaaaaaaaaa' },
];

describe('rote memory', () => {
  it('lists nothing gracefully before any site memory exists', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'rote-mem-'));
    expect(await listMemoryPartitions(baseDir, new Date(at))).toEqual([]);
    expect(await main(['memory'], baseDir)).toContain('no site memory yet');
  });

  it('lists partitions with consolidated fact counts by kind', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'rote-mem-'));
    await new FileSiteMemoryStore(baseDir).append(FP, records);
    const summaries = await listMemoryPartitions(baseDir, new Date(at));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ fingerprintHash: FP, records: 3, facts: 3, byKind: { selector_map: 1, settle_prior: 1, quirk: 1 } });
    expect(formatMemoryList(summaries)).toContain('3 records → 3 consolidated facts');
  });

  it('inspects one partition value-free and previews the brief exactly as a run would render it', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'rote-mem-'));
    await new FileSiteMemoryStore(baseDir).append(FP, records);
    const inspection = await inspectMemory(baseDir, FP, new Date(at), 600);
    const text = formatMemoryInspection(inspection);
    expect(text).toContain('[selector_map]');
    expect(text).toContain('#company-name');
    expect(text).toContain('fill p50 80 ms / p90 120 ms (3 samples)');
    expect(text).toContain('enter_inserts_newline');
    expect(inspection.briefPreview?.text).toContain('Site memory (advisory');
    // value-free: no captured content in the store means none can appear here
    expect(text).not.toContain('Acme');
    const cli = await main(['memory', FP, '--brief-chars', '600'], baseDir);
    expect(cli).toContain('brief preview');
  });
});
