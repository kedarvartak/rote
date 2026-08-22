import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pageKey, SiteMemoryRecordSchema } from '@rote/core';
import { consolidateSiteMemory, deriveSiteMemory, LONG_SETTLE_P90_MS, renderSiteBrief, type SiteMemoryEvent } from '../src/index.js';

// Property suites for the pure tier-2 functions (CLAUDE.md: pure logic lives in
// dependency-free functions so it's property-testable). Two subjects:
// settle-prior aggregation (nearest-rank percentiles) and the brief's hard
// character cap — the budget contract that makes the brief safe to place in
// the planner's cache-stable prefix.

const FORM = pageKey('https://fixture.test/vendors/register')!;
const at = '2026-08-22T00:00:00.000Z';
const digest = { sha256: '0'.repeat(64), byte_length: 1, preview: '' };
const options = { fingerprintHash: 'fp-1', runId: 'run-1', observedAt: at };

function fillEvent(seq: number, settleMs: number): SiteMemoryEvent {
  const result = {
    post_action_evidence: { passed: true },
    page_key: FORM,
    settle_ms: settleMs,
    resolution: { selector: `#f${seq}`, strategy: 'stable-id', stableId: `v2:${String(seq).padStart(16, '0')}` },
  };
  return {
    event: { run_id: 'run-1', seq, ts: at, tool: 'browser.fill', args: { kind: 'fill', selector: `#f${seq}`, role: 'textbox', name: `F${seq}`, value: 'x' }, result_digest: digest, result_ref: { kind: 'inline', value: result }, duration_ms: 1 },
    result,
  };
}

describe('settle-prior aggregation (property)', () => {
  const samplesArb = fc.array(fc.nat({ max: 60_000 }), { minLength: 1, maxLength: 40 });

  it('emits nearest-rank percentiles that are ordered, members of the sample set, and deterministic', () => {
    fc.assert(fc.property(samplesArb, (samples) => {
      const events = samples.map((settleMs, index) => fillEvent(index, settleMs));
      const report = deriveSiteMemory(events, options);
      const priors = report.records.filter((record) => record.kind === 'settle_prior');
      expect(priors).toHaveLength(1);
      const prior = priors[0]!;
      if (prior.kind !== 'settle_prior') throw new Error('unreachable');
      expect(prior.samples).toBe(samples.length);
      expect(prior.p50_ms).toBeLessThanOrEqual(prior.p90_ms);
      expect(prior.p90_ms).toBeLessThanOrEqual(prior.max_ms);
      expect(prior.max_ms).toBe(Math.max(...samples));
      // nearest-rank: every reported percentile is an actually observed sample
      expect(samples).toContain(prior.p50_ms);
      expect(samples).toContain(prior.p90_ms);
      SiteMemoryRecordSchema.parse(prior);
      // deterministic: same events, same records
      expect(deriveSiteMemory(events, options).records).toEqual(report.records);
    }), { numRuns: 200 });
  });

  it('emits the coded long_settle quirk exactly when p90 crosses the documented threshold', () => {
    fc.assert(fc.property(samplesArb, (samples) => {
      const events = samples.map((settleMs, index) => fillEvent(index, settleMs));
      const records = deriveSiteMemory(events, options).records;
      const prior = records.find((record) => record.kind === 'settle_prior')!;
      if (prior.kind !== 'settle_prior') throw new Error('unreachable');
      const quirk = records.some((record) => record.kind === 'quirk' && record.code === 'long_settle');
      expect(quirk).toBe(prior.p90_ms >= LONG_SETTLE_P90_MS);
    }), { numRuns: 200 });
  });
});

describe('site brief budget (property)', () => {
  const recordArb = fc.integer({ min: 0, max: 2 }).chain((kind) => fc.record({
    seq: fc.nat({ max: 1000 }),
    name: fc.stringMatching(/^[A-Za-z ]{1,30}$/),
    ms: fc.nat({ max: 60_000 }),
  }).map(({ seq, name, ms }) => {
    const common = { version: 1 as const, record_id: `r${seq}-${kind}-${name.length}-${ms}`, fingerprint_hash: 'fp-1', observed_at: at, run_id: 'run-1', source: 'observed' as const, confidence: 1 };
    if (kind === 0) return { ...common, kind: 'selector_map' as const, page_key: FORM, stable_id: `v2:${String(seq).padStart(16, '0')}`, role: 'textbox', name, selector: `#field-${seq}`, strategy: 'stable-id' };
    if (kind === 1) return { ...common, kind: 'settle_prior' as const, page_key: FORM, action_kind: 'fill', samples: 1 + (seq % 5), p50_ms: ms, p90_ms: ms, max_ms: ms };
    return { ...common, kind: 'quirk' as const, page_key: FORM, code: 'enter_inserts_newline' as const, stable_id: `v2:${String(seq).padStart(16, '0')}` };
  }));

  it('never exceeds the hard character cap, for any records and any cap', () => {
    fc.assert(fc.property(
      fc.array(recordArb, { maxLength: 30 }),
      fc.integer({ min: 1, max: 2000 }),
      (records, maxChars) => {
        const view = consolidateSiteMemory(records, { now: new Date(at) });
        const brief = renderSiteBrief(view, { maxChars });
        expect(brief.text.length).toBeLessThanOrEqual(maxChars);
        // deterministic
        expect(renderSiteBrief(view, { maxChars })).toEqual(brief);
        // an empty render hints nothing
        if (brief.text === '') expect(brief.hintedStableIds).toEqual([]);
      },
    ), { numRuns: 200 });
  });
});
