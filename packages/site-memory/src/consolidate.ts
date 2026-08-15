import { siteMemoryRecordKey, type SiteMemoryRecord, type SiteMemoryRecordKind } from '@rote/core';

// Append-only store, consolidation on read: successive observations of the same
// fact (same record key) collapse to the newest, carrying how often and how
// recently it was seen. Everything here is pure; `now` is injected.

export interface ConsolidatedFact<R extends SiteMemoryRecord = SiteMemoryRecord> {
  key: string;
  /** Newest record for this key. */
  latest: R;
  /** How many records asserted this key. */
  observations: number;
  firstObservedAt: string;
  lastObservedAt: string;
  /** Exponential freshness in (0, 1]: 1 when observed now, 0.5 after one half-life. */
  freshness: number;
  /** Advisory score = latest.confidence × freshness. Readers rank and cut on it. */
  score: number;
  /** True when a newer record for the same key disagrees with an older one — the fact moved. */
  changed: boolean;
}

export interface ConsolidateOptions {
  now: Date;
  /** Freshness half-life; default 30 days. */
  halfLifeMs?: number;
}

export interface SiteMemoryView {
  facts: ConsolidatedFact[];
  byKind<K extends SiteMemoryRecordKind>(kind: K): ConsolidatedFact<Extract<SiteMemoryRecord, { kind: K }>>[];
}

const DEFAULT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** Collapses an append-only record list into ranked facts; ties on time keep write order (later wins). */
export function consolidateSiteMemory(records: readonly SiteMemoryRecord[], options: ConsolidateOptions): SiteMemoryView {
  const halfLife = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  const groups = new Map<string, SiteMemoryRecord[]>();
  for (const record of records) {
    const key = siteMemoryRecordKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const facts: ConsolidatedFact[] = [];
  for (const [key, group] of groups) {
    const ordered = [...group].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    const latest = ordered[ordered.length - 1]!;
    const first = ordered[0]!;
    const ageMs = Math.max(0, options.now.getTime() - Date.parse(latest.observed_at));
    const freshness = Math.pow(0.5, ageMs / halfLife);
    const changed = ordered.some((record) => factBody(record) !== factBody(latest));
    facts.push({ key, latest, observations: ordered.length, firstObservedAt: first.observed_at, lastObservedAt: latest.observed_at, freshness, score: latest.confidence * freshness, changed });
  }
  facts.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return {
    facts,
    byKind: (kind) => facts.filter((fact): fact is ConsolidatedFact<never> => fact.latest.kind === kind) as never,
  };
}

/** The asserted content of a record minus its provenance — what "the same fact" means. */
function factBody(record: SiteMemoryRecord): string {
  const { record_id: _id, observed_at: _at, run_id: _run, confidence: _confidence, source: _source, ...body } = record;
  return JSON.stringify(body, Object.keys(body).sort());
}
