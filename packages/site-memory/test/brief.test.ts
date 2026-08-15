import { describe, expect, it } from 'vitest';
import { pageKey, type SiteMemoryRecord } from '@rote/core';
import { consolidateSiteMemory, deriveSiteMemory, renderSiteBrief, type SiteMemoryEvent } from '../src/index.js';

const FORM = pageKey('https://fixture.test/vendors/register')!;
const DONE = pageKey('https://fixture.test/vendors/complete')!;
const contract = (verb: 'fill' | 'click', role: string, name: string, stableId: string, affordance: Record<string, unknown>, safety = 'local_input') => ({
  version: 1, verb, target: { role, name, stable_id: stableId }, affordance: { draggable: false, ...affordance }, safety, preconditions: { visible: true, enabled: true },
});
function event(seq: number, tool: string, args: Record<string, unknown>, result: unknown): SiteMemoryEvent {
  return { event: { run_id: 'run-1', seq, ts: '2026-08-16T00:00:00.000Z', tool, args, result_digest: { sha256: '0'.repeat(64), byte_length: 1, preview: '' }, result_ref: { kind: 'inline', value: result }, duration_ms: 1 }, result };
}
const dispatched = { passed: true };
const run: SiteMemoryEvent[] = [
  event(1, 'browser.fill', { kind: 'fill', selector: '#company-name', role: 'textbox', name: 'Company name', value: 'Acme Tools' }, { post_action_evidence: dispatched, page_key: FORM, next_page_key: FORM, resolution: { selector: '#company-name', strategy: 'stable-id', stableId: 'v2:aaaaaaaaaaaaaaaa' }, action_contract: contract('fill', 'textbox', 'Company name', 'v2:aaaaaaaaaaaaaaaa', { control: 'single_line_text', input_type: 'text', enter_behavior: 'submits_form' }) }),
  event(2, 'browser.fill', { kind: 'fill', selector: '#notes', role: 'textbox', name: 'Notes', value: 'hunter2' }, { post_action_evidence: dispatched, page_key: FORM, next_page_key: FORM, resolution: { selector: '#notes', strategy: 'stable-id', stableId: 'v2:bbbbbbbbbbbbbbbb' }, action_contract: contract('fill', 'textbox', 'Notes', 'v2:bbbbbbbbbbbbbbbb', { control: 'multi_line_text', enter_behavior: 'inserts_newline' }) }),
  event(3, 'browser.click', { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' }, { post_action_evidence: dispatched, page_key: FORM, next_page_key: DONE, resolution: { selector: '#registration-submit', strategy: 'stable-id', stableId: 'v2:cccccccccccccccc' }, action_contract: contract('click', 'button', 'Submit registration', 'v2:cccccccccccccccc', { control: 'submit', enter_behavior: 'none', destination_hash: 'd'.repeat(16), form_method: 'post' }, 'mutating') }),
];
const now = new Date('2026-08-16T00:00:00.000Z');
const view = () => consolidateSiteMemory(deriveSiteMemory(run, { fingerprintHash: 'fp', runId: 'run-1', observedAt: '2026-08-16T00:00:00.000Z' }).records, { now });

describe('site brief', () => {
  it('renders ranked, value-free advice under a hard character budget and reports what it dropped', () => {
    const full = renderSiteBrief(view(), { maxChars: 4_000 });
    expect(full.text).toContain('Site memory (advisory');
    expect(full.text).toContain('Enter inserts a newline in this field');
    expect(full.text).toContain('this submit is a server-side mutation (POST); do not repeat it');
    expect(full.text).toContain(`leads to page ${DONE}`);
    expect(full.factsDropped).toBe(0);
    expect(full.hintedStableIds.sort()).toEqual(['v2:aaaaaaaaaaaaaaaa', 'v2:bbbbbbbbbbbbbbbb', 'v2:cccccccccccccccc']);
    for (const leaked of ['Acme Tools', 'hunter2', 'https://', 'fixture.test', '/vendors']) expect(full.text).not.toContain(leaked);

    const tight = renderSiteBrief(view(), { maxChars: 420 });
    expect(tight.text.length).toBeLessThanOrEqual(420);
    expect(tight.factsIncluded).toBeGreaterThan(0);
    expect(tight.factsIncluded + tight.factsDropped).toBe(full.factsIncluded);
    // Deterministic — the brief sits in the planner's cache-stable prefix.
    expect(renderSiteBrief(view(), { maxChars: 420 })).toEqual(tight);
    // Below the smallest line nothing renders — the cap is hard, never approximate.
    expect(renderSiteBrief(view(), { maxChars: 120 }).text).toBe('');
  });

  it('renders nothing for an empty or all-stale view, and ranks the current page first', () => {
    expect(renderSiteBrief(consolidateSiteMemory([], { now }), { maxChars: 1_000 })).toEqual({ text: '', factsIncluded: 0, factsDropped: 0, hintedStableIds: [] });
    const stale = consolidateSiteMemory(deriveSiteMemory(run, { fingerprintHash: 'fp', runId: 'r', observedAt: '2025-01-01T00:00:00.000Z' }).records, { now });
    expect(renderSiteBrief(stale, { maxChars: 1_000 }).text).toBe('');
    const onDone = renderSiteBrief(view(), { maxChars: 4_000, currentPageKey: DONE });
    const onForm = renderSiteBrief(view(), { maxChars: 4_000, currentPageKey: FORM });
    expect(onForm.text.split('\n')[1]).toContain(`page ${FORM}`);
    expect(onDone.text).toBe(renderSiteBrief(view(), { maxChars: 4_000 }).text); // no fact is *on* the done page; order falls back to score
  });

  it('flags a fact that moved between observations', () => {
    const records = deriveSiteMemory(run, { fingerprintHash: 'fp', runId: 'run-1', observedAt: '2026-08-15T00:00:00.000Z' }).records;
    const moved = records.filter((record): record is Extract<SiteMemoryRecord, { kind: 'selector_map' }> => record.kind === 'selector_map' && record.stable_id === 'v2:aaaaaaaaaaaaaaaa')
      .map((record) => ({ ...record, record_id: `${record.record_id}#2`, observed_at: '2026-08-16T00:00:00.000Z', selector: '#company-name-v2' }));
    const brief = renderSiteBrief(consolidateSiteMemory([...records, ...moved], { now }), { maxChars: 4_000 });
    expect(brief.text).toContain('resolved as #company-name-v2 (moved before; verify)');
  });
});
