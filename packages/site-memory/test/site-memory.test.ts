import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pageKey, SiteMemoryRecordSchema, siteMemoryRecordKey, type SiteMemoryRecord } from '@rote/core';
import { consolidateSiteMemory, deriveSiteMemory, type SiteMemoryEvent } from '../src/index.js';

const FORM = pageKey('https://fixture.test/vendors/register')!;
const DONE = pageKey('https://fixture.test/vendors/complete')!;
const contract = (verb: 'fill' | 'click', role: string, name: string, stableId: string, affordance: Record<string, unknown>, safety = 'local_input') => ({
  version: 1, verb, target: { role, name, stable_id: stableId }, affordance: { draggable: false, ...affordance }, safety, preconditions: { visible: true, enabled: true },
});

function event(seq: number, tool: string, args: Record<string, unknown>, result: unknown): SiteMemoryEvent {
  return {
    event: { run_id: 'run-1', seq, ts: '2026-08-16T00:00:00.000Z', tool, args, result_digest: { sha256: '0'.repeat(64), byte_length: 1, preview: '' }, result_ref: { kind: 'inline', value: result }, duration_ms: 1 },
    result,
  };
}
const dispatched = { passed: true };

const run: SiteMemoryEvent[] = [
  event(0, 'browser.navigate', { kind: 'navigate', url: 'https://fixture.test/vendors/register?token=secret' }, { post_action_evidence: dispatched, page_key: pageKey('https://fixture.test/'), next_page_key: FORM }),
  event(1, 'browser.fill', { kind: 'fill', selector: '#company-name', role: 'textbox', name: 'Company name', value: 'Acme Tools' }, {
    post_action_evidence: dispatched, page_key: FORM, next_page_key: FORM,
    resolution: { selector: '#company-name', strategy: 'stable-id', stableId: 'v2:aaaaaaaaaaaaaaaa' },
    action_contract: contract('fill', 'textbox', 'Company name', 'v2:aaaaaaaaaaaaaaaa', { control: 'single_line_text', input_type: 'text', enter_behavior: 'submits_form' }),
  }),
  event(2, 'browser.fill', { kind: 'fill', selector: '#notes', role: 'textbox', name: 'Notes', value: 'hunter2' }, {
    post_action_evidence: dispatched, page_key: FORM, next_page_key: FORM,
    resolution: { selector: 'html > body > form > textarea', strategy: 'role-name', stableId: 'v2:bbbbbbbbbbbbbbbb' },
    action_contract: contract('fill', 'textbox', 'Notes', 'v2:bbbbbbbbbbbbbbbb', { control: 'multi_line_text', enter_behavior: 'inserts_newline' }),
  }),
  event(3, 'browser.click', { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' }, {
    post_action_evidence: dispatched, page_key: FORM, next_page_key: DONE,
    resolution: { selector: '#registration-submit', strategy: 'stable-id', stableId: 'v2:cccccccccccccccc' },
    action_contract: contract('click', 'button', 'Submit registration', 'v2:cccccccccccccccc', { control: 'submit', enter_behavior: 'none', destination_hash: 'd'.repeat(16), form_method: 'post' }, 'mutating'),
  }),
  event(4, 'browser.click', { kind: 'click', selector: '#missing' }, {}),
  event(5, 'browser.done', { kind: 'done', success: true, summary: 'ok' }, {}),
];
const options = { fingerprintHash: 'fp-1', runId: 'run-1', observedAt: '2026-08-16T00:00:00.000Z' };

/** Every string value (not key) anywhere in the records — the places a captured input could leak. */
function leafStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leafStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leafStrings);
  return [];
}

describe('site memory derivation', () => {
  it('derives selector maps, page edges, form semantics, and quirks from one recorded run — value-free', () => {
    const report = deriveSiteMemory(run, options);
    expect(report.skipped).toEqual([{ seq: 4, reason: 'not_dispatched' }, { seq: 5, reason: 'terminal_done' }]);
    const kinds = report.records.map((record) => record.kind);
    expect(kinds.filter((kind) => kind === 'selector_map')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'page_edge')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'form_semantics')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'quirk')).toHaveLength(2);
    for (const record of report.records) SiteMemoryRecordSchema.parse(record);
    expect(report.records.find((record) => record.kind === 'page_edge' && record.action_kind === 'click')).toMatchObject({ from_page_key: FORM, to_page_key: DONE, stable_id: 'v2:cccccccccccccccc', role: 'button', name: 'Submit registration' });
    expect(report.records.find((record) => record.kind === 'form_semantics')).toMatchObject({ page_key: FORM, destination_hash: 'd'.repeat(16), method: 'post', safety: 'mutating', fields: [{ stable_id: 'v2:aaaaaaaaaaaaaaaa' }, { stable_id: 'v2:bbbbbbbbbbbbbbbb' }] });
    expect(report.records.filter((record) => record.kind === 'quirk').map((record) => (record as { code: string }).code).sort()).toEqual(['enter_inserts_newline', 'submit_is_mutating']);
    const serialized = JSON.stringify(report.records);
    for (const leaked of ['Acme Tools', 'hunter2', 'token=secret', 'https://', 'fixture.test']) expect(serialized).not.toContain(leaked);
    // Deterministic: same input, same records (ids included).
    expect(deriveSiteMemory(run, options)).toEqual(report);
  });

  it('never carries a dispatched value, URL, or query into any record (property)', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z0-9 @.-]{3,24}$/), fc.stringMatching(/^[a-z0-9-]{3,12}$/), (value, path) => {
      const events = [
        event(0, 'browser.navigate', { kind: 'navigate', url: `https://fixture.test/${path}?q=${value}` }, { post_action_evidence: dispatched, page_key: pageKey('https://fixture.test/'), next_page_key: pageKey(`https://fixture.test/${path}`) }),
        event(1, 'browser.fill', { kind: 'fill', selector: '#f', role: 'textbox', name: 'Field', value }, { post_action_evidence: dispatched, page_key: pageKey(`https://fixture.test/${path}`), resolution: { selector: '#f', strategy: 'selector', stableId: 'v2:aaaaaaaaaaaaaaaa' }, action_contract: contract('fill', 'textbox', 'Field', 'v2:aaaaaaaaaaaaaaaa', { control: 'single_line_text', enter_behavior: 'submits_form' }) }),
      ];
      const leaves = leafStrings(deriveSiteMemory(events, options).records);
      return leaves.every((leaf) => !leaf.includes(value) && !leaf.includes(`/${path}`));
    }));
  });
});

describe('site memory settle priors', () => {
  it('aggregates measured settles into per-page, per-kind settle priors with nearest-rank percentiles', () => {
    const settled: SiteMemoryEvent[] = [
      event(0, 'browser.fill', { kind: 'fill', selector: '#a', role: 'textbox', name: 'A', value: 'x' }, {
        post_action_evidence: dispatched, page_key: FORM, settle_ms: 40,
        resolution: { selector: '#a', strategy: 'stable-id', stableId: 'v2:aaaaaaaaaaaaaaaa' },
      }),
      event(1, 'browser.fill', { kind: 'fill', selector: '#b', role: 'textbox', name: 'B', value: 'y' }, {
        post_action_evidence: dispatched, page_key: FORM, settle_ms: 120,
        resolution: { selector: '#b', strategy: 'stable-id', stableId: 'v2:bbbbbbbbbbbbbbbb' },
      }),
      event(2, 'browser.fill', { kind: 'fill', selector: '#c', role: 'textbox', name: 'C', value: 'z' }, {
        post_action_evidence: dispatched, page_key: FORM, settle_ms: 80,
        resolution: { selector: '#c', strategy: 'stable-id', stableId: 'v2:cccccccccccccccc' },
      }),
      event(3, 'browser.click', { kind: 'click', selector: '#go', role: 'button', name: 'Go' }, {
        post_action_evidence: dispatched, page_key: FORM, next_page_key: DONE, settle_ms: 3500,
        resolution: { selector: '#go', strategy: 'stable-id', stableId: 'v2:dddddddddddddddd' },
      }),
    ];
    const report = deriveSiteMemory(settled, options);
    const priors = report.records.filter((record) => record.kind === 'settle_prior');
    expect(priors).toEqual([
      expect.objectContaining({ page_key: FORM, action_kind: 'fill', samples: 3, p50_ms: 80, p90_ms: 120, max_ms: 120 }),
      expect.objectContaining({ page_key: FORM, action_kind: 'click', samples: 1, p50_ms: 3500, p90_ms: 3500, max_ms: 3500 }),
    ]);
    // A p90 at or past the documented threshold earns the coded long_settle quirk — never free text.
    const quirks = report.records.filter((record) => record.kind === 'quirk' && record.code === 'long_settle');
    expect(quirks).toEqual([expect.objectContaining({ page_key: FORM })]);
    // Every emitted record still validates and consolidates.
    for (const record of [...priors, ...quirks]) SiteMemoryRecordSchema.parse(record);
    // A run without measured settles derives none.
    expect(deriveSiteMemory(run, options).records.some((record) => record.kind === 'settle_prior')).toBe(false);
  });
});

describe('site memory consolidation', () => {
  const at = (iso: string, record: SiteMemoryRecord, overrides: Partial<SiteMemoryRecord> = {}) => ({ ...record, ...overrides, observed_at: iso, record_id: `${record.record_id}@${iso}` } as SiteMemoryRecord);

  it('collapses successive observations of one fact to the newest, flags a moved fact, and ranks by confidence × freshness', () => {
    const base = deriveSiteMemory(run, options).records;
    const selector = base.find((record) => record.kind === 'selector_map' && record.stable_id === 'v2:aaaaaaaaaaaaaaaa')!;
    const moved = at('2026-08-15T00:00:00.000Z', selector, { selector: '#company-name-v2', strategy: 'role-name' } as never);
    const older = at('2026-07-01T00:00:00.000Z', selector);
    const view = consolidateSiteMemory([older, ...base, moved], { now: new Date('2026-08-16T00:00:00.000Z') });
    const fact = view.facts.find((entry) => entry.key === siteMemoryRecordKey(selector))!;
    expect(fact.observations).toBe(3);
    // Newest by observed_at wins even though it was appended last with an older selector.
    expect(fact.latest).toEqual(base.find((record) => record.record_id === selector.record_id));
    expect(fact.changed).toBe(true);
    expect(fact.freshness).toBe(1);
    const stale = consolidateSiteMemory([older], { now: new Date('2026-08-16T00:00:00.000Z'), halfLifeMs: 46 * 24 * 3600 * 1000 });
    expect(stale.facts[0]!.freshness).toBeCloseTo(0.5, 5);
    expect(stale.facts[0]!.score).toBeCloseTo(0.5, 5);
    expect(view.byKind('page_edge').every((entry) => entry.latest.kind === 'page_edge')).toBe(true);
    expect(view.byKind('page_edge')).toHaveLength(2);
    expect(view.facts.map((entry) => entry.score)).toEqual([...view.facts.map((entry) => entry.score)].sort((a, b) => b - a));
  });
});
