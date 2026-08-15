import type { SiteMemoryRecord } from '@rote/core';
import type { ConsolidatedFact, SiteMemoryView } from './consolidate.js';

// see docs/02-architecture.md "Tiers 1 and 2 — the learning plane" — the site
// brief is tier-2 memory rendered as tier-0 content: advisory, value-free, and
// inside a hard character budget ("a 2K brief at 5% utility is overhead, not
// memory"). Facts are ranked by confidence × freshness and cut at the budget;
// the render is deterministic so it can sit in the planner's cache-stable prefix.

export interface RenderSiteBriefOptions {
  /** Hard cap on rendered characters (≈ tokens × 4); the header counts. */
  maxChars: number;
  /** When set, facts on this page rank first; others follow by score. */
  currentPageKey?: string;
  /** Facts below this score are not rendered (default 0.2 — stale or low-confidence advice is noise). */
  minScore?: number;
}

export interface SiteBrief {
  /** Empty string when nothing qualifies — the caller omits the section entirely. */
  text: string;
  factsIncluded: number;
  factsDropped: number;
  /** Stable identity refs the brief mentions; the agent reports how many the planner actually used (hint utility). */
  hintedStableIds: string[];
}

const HEADER = 'Site memory (advisory, learned from earlier runs on this site; may be stale — trust the observation over it):';
const DEFAULT_MIN_SCORE = 0.2;

/** Renders a budgeted, ranked, value-free brief from a consolidated view. Pure. */
export function renderSiteBrief(view: SiteMemoryView, options: RenderSiteBriefOptions): SiteBrief {
  const eligible = view.facts.filter((fact) => fact.score >= (options.minScore ?? DEFAULT_MIN_SCORE));
  const ranked = [...eligible].sort((a, b) => {
    const aHere = onPage(a, options.currentPageKey) ? 1 : 0;
    const bHere = onPage(b, options.currentPageKey) ? 1 : 0;
    return bHere - aHere || b.score - a.score || a.key.localeCompare(b.key);
  });
  const lines: string[] = [];
  const hinted = new Set<string>();
  let used = HEADER.length;
  let included = 0;
  for (const fact of ranked) {
    const line = renderFact(fact);
    if (!line) continue;
    if (used + 1 + line.length > options.maxChars) break; // budget is a hard cap, ranked facts first
    lines.push(line);
    used += 1 + line.length;
    included += 1;
    for (const id of stableIdsOf(fact.latest)) hinted.add(id);
  }
  return {
    text: lines.length === 0 ? '' : `${HEADER}\n${lines.join('\n')}`,
    factsIncluded: included,
    factsDropped: ranked.length - included,
    hintedStableIds: [...hinted],
  };
}

function onPage(fact: ConsolidatedFact, pageKey: string | undefined): boolean {
  if (!pageKey) return false;
  const record = fact.latest;
  switch (record.kind) {
    case 'page_edge': return record.from_page_key === pageKey;
    case 'quirk': return record.page_key === pageKey;
    default: return record.page_key === pageKey;
  }
}

function renderFact(fact: ConsolidatedFact): string | undefined {
  const record = fact.latest;
  const stale = fact.changed ? ' (moved before; verify)' : '';
  switch (record.kind) {
    case 'selector_map':
      return `- ${record.role}${record.name ? ` "${record.name}"` : ''} [${record.stable_id}] on page ${record.page_key} resolved as ${record.selector}${stale}`;
    case 'form_semantics': {
      const fields = record.fields.map((field) => `${field.role}${field.name ? ` "${field.name}"` : ''}${field.stable_id ? ` [${field.stable_id}]` : ''}`).join(', ');
      const submit = record.destination_hash ? `; submits ${record.method ?? 'get'} to ${record.destination_hash}${record.safety ? ` (${record.safety})` : ''}` : '';
      return `- form on page ${record.page_key}: ${fields}${submit}${stale}`;
    }
    case 'page_edge':
      return `- ${record.action_kind}${record.name ? ` "${record.name}"` : ''}${record.stable_id ? ` [${record.stable_id}]` : ''} on page ${record.from_page_key} leads to page ${record.to_page_key}${stale}`;
    case 'settle_prior':
      return `- ${record.action_kind} on page ${record.page_key} settles in ~${Math.round(record.p50_ms)} ms (p90 ${Math.round(record.p90_ms)} ms, ${record.samples} samples)`;
    case 'quirk':
      return `- ${QUIRK_TEXT[record.code]}${record.stable_id ? ` [${record.stable_id}]` : ''}${record.page_key ? ` on page ${record.page_key}` : ''}`;
  }
}

/** Closed vocabulary → fixed wording: nothing page- or model-authored reaches the planner through a quirk. */
const QUIRK_TEXT: Record<Extract<SiteMemoryRecord, { kind: 'quirk' }>['code'], string> = {
  enter_inserts_newline: 'Enter inserts a newline in this field (does not submit)',
  submit_is_mutating: 'this submit is a server-side mutation (POST); do not repeat it',
  form_requires_all_fields: 'this form requires every field before submitting',
  route_changes_without_document: 'this site changes routes without loading a new document',
  long_settle: 'this page settles slowly after actions',
};

function stableIdsOf(record: SiteMemoryRecord): string[] {
  switch (record.kind) {
    case 'selector_map': return [record.stable_id];
    case 'form_semantics': return record.fields.flatMap((field) => (field.stable_id ? [field.stable_id] : []));
    case 'page_edge': return record.stable_id ? [record.stable_id] : [];
    case 'quirk': return record.stable_id ? [record.stable_id] : [];
    case 'settle_prior': return [];
  }
}
