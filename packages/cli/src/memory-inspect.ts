import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { consolidateSiteMemory, FileSiteMemoryStore, renderSiteBrief, type SiteMemoryView } from '@rote/site-memory';
import { isMissing } from './artifact-status.js';

// see docs/02 "Tiers 1 and 2" — site memory is advisory and value-free by
// construction, so inspecting it is safe to print verbatim: identities,
// digests, and coded quirks, never page content or user input.

export interface MemoryPartitionSummary {
  fingerprintHash: string;
  records: number;
  facts: number;
  byKind: Record<string, number>;
}

export interface MemoryInspection {
  fingerprintHash: string;
  records: number;
  view: SiteMemoryView;
  briefPreview?: { chars: number; text: string };
}

/** Lists every site-memory partition under `<baseDir>/site-memory` with record/fact counts. */
export async function listMemoryPartitions(baseDir: string, now: Date): Promise<MemoryPartitionSummary[]> {
  let hashes: string[];
  try {
    hashes = await readdir(join(baseDir, 'site-memory'));
  } catch (error) {
    // No site-memory directory means no partitions; anything else is a real
    // read failure and saying "no memory" would be a lie.
    if (isMissing(error)) return [];
    throw error;
  }
  const store = new FileSiteMemoryStore(baseDir);
  const summaries: MemoryPartitionSummary[] = [];
  for (const encoded of hashes.sort()) {
    const fingerprintHash = decodeURIComponent(encoded);
    const records = await store.read(fingerprintHash);
    const view = consolidateSiteMemory(records, { now });
    const byKind: Record<string, number> = {};
    for (const fact of view.facts) byKind[fact.latest.kind] = (byKind[fact.latest.kind] ?? 0) + 1;
    summaries.push({ fingerprintHash, records: records.length, facts: view.facts.length, byKind });
  }
  return summaries;
}

/** Reads and consolidates one partition; optionally renders the brief exactly as `rote run` would. */
export async function inspectMemory(baseDir: string, fingerprintHash: string, now: Date, briefChars?: number): Promise<MemoryInspection> {
  const records = await new FileSiteMemoryStore(baseDir).read(fingerprintHash);
  const view = consolidateSiteMemory(records, { now });
  const brief = briefChars !== undefined ? renderSiteBrief(view, { maxChars: briefChars }) : undefined;
  return {
    fingerprintHash,
    records: records.length,
    view,
    ...(brief ? { briefPreview: { chars: brief.text.length, text: brief.text } } : {}),
  };
}

/** Renders partition summaries for the terminal. */
export function formatMemoryList(summaries: MemoryPartitionSummary[]): string {
  if (summaries.length === 0) return 'no site memory yet — record a run, then rote distill <run_id>';
  return summaries.map((summary) => {
    const kinds = Object.entries(summary.byKind).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => `${count} ${kind}`).join(', ') || 'none';
    return `${summary.fingerprintHash.slice(0, 16)}… — ${summary.records} records → ${summary.facts} consolidated facts (${kinds})`;
  }).join('\n');
}

/** Renders one partition's consolidated facts (value-free) plus the optional brief preview. */
export function formatMemoryInspection(inspection: MemoryInspection): string {
  const lines = [`site memory for ${inspection.fingerprintHash}`, `records: ${inspection.records} → ${inspection.view.facts.length} consolidated facts`];
  for (const fact of inspection.view.facts) {
    const record = fact.latest;
    const where = 'page_key' in record && record.page_key ? ` @ ${record.page_key}` : '';
    const what = record.kind === 'selector_map' ? `${record.stable_id} → ${record.selector} (${record.strategy})`
      : record.kind === 'page_edge' ? `${record.from_page_key} → ${record.to_page_key} via ${record.action_kind}`
      : record.kind === 'form_semantics' ? `${record.fields.length} fields${record.method ? `, ${record.method}` : ''}${record.safety ? `, ${record.safety}` : ''}`
      : record.kind === 'settle_prior' ? `${record.action_kind} p50 ${Math.round(record.p50_ms)} ms / p90 ${Math.round(record.p90_ms)} ms (${record.samples} samples)`
      : record.code;
    lines.push(`  [${record.kind}]${where} ${what} — score ${fact.score.toFixed(2)} (${fact.observations} obs, freshness ${fact.freshness.toFixed(2)})`);
  }
  if (inspection.briefPreview) {
    lines.push(`brief preview (${inspection.briefPreview.chars} chars):`);
    lines.push(inspection.briefPreview.text || '(empty — nothing clears the score threshold)');
  }
  return lines.join('\n');
}
