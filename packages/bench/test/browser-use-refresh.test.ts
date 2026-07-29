import { describe, expect, it } from 'vitest';
import {
  buildBrowserUseRefreshQualification,
  renderBrowserUseRefreshQualification,
  type BrowserUseRefreshReceipt,
} from '../src/browser-use-refresh.js';

const mutations = ['fields-renamed', 'submit-renamed', 'wrappers', 'stale-selector-decoys', 'ambiguous-company'] as const;

function receipt(
  phase: 'qualification' | 'b5_cold',
  mutation: 'canonical' | typeof mutations[number],
  repetition: number,
): BrowserUseRefreshReceipt {
  return {
    schema_version: 1,
    protocol_id: 'browser-use-v0.13.7-b2-b5-qualification-v1',
    harness: 'browser-use',
    harness_version: '0.13.7',
    source_commit: 'f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc',
    wheel_sha256: '2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    viewport: { width: 1920, height: 1080 },
    task: 'B2',
    phase,
    mutation,
    repetition,
    initial_url: `http://127.0.0.1:8093/b2-vendor-drift.html${mutation === 'canonical' ? '' : `?mutation=${mutation}`}`,
    verify_text: 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148',
    harness_success: true,
    exact_live_verification: true,
    outcome: 'cold_success',
    usage: { input_tokens: 60, cache_read_tokens: 40, cache_write_tokens: 0, output_tokens: 5 },
    raw_provider_receipts: [{
      model: 'gpt-4.1-mini',
      usage: { prompt_tokens: 100, prompt_cached_tokens: 40, completion_tokens: 5 },
    }],
    provider_receipts_complete: true,
    duration_ms: 100,
    error: null,
    raw_dump: `raw/${phase}-${mutation}-r${repetition}.json`,
  };
}

function completeReceipts(): BrowserUseRefreshReceipt[] {
  return [
    receipt('qualification', 'canonical', 1),
    receipt('qualification', 'canonical', 2),
    receipt('qualification', 'canonical', 3),
    ...mutations.map((mutation) => receipt('b5_cold', mutation, 1)),
  ];
}

describe('Browser Use 0.13.7 refresh qualification', () => {
  it('qualifies only a separate B2 certification after three exact cold attempts and all diagnostics', () => {
    const { summary, records } = buildBrowserUseRefreshQualification(completeReceipts());
    expect(summary.decision).toBe('qualify_b2_for_certification');
    expect(summary.cold_exact_successes).toBe(3);
    expect(summary.b5_exact_successes).toBe(5);
    expect(summary.complete_provider_receipts).toBe(8);
    expect(records).toHaveLength(8);
    expect(renderBrowserUseRefreshQualification(summary)).toContain('not a Browser Use 0.13.7-vs-Rote efficiency');
  });

  it('stops when a B5 diagnostic is missing', () => {
    const { summary } = buildBrowserUseRefreshQualification(completeReceipts().slice(0, -1));
    expect(summary.decision).toBe('stop_before_certification');
    expect(summary.disqualifications).toContain('only 4/5 frozen B5 cold diagnostics are present');
  });

  it('retains missing usage as unrankable instead of emitting a zero-token neutral row', () => {
    const receipts = completeReceipts();
    receipts[0]!.usage = null;
    receipts[0]!.raw_provider_receipts = [];
    receipts[0]!.provider_receipts_complete = false;
    receipts[0]!.outcome = 'abandoned';
    receipts[0]!.harness_success = false;
    receipts[0]!.exact_live_verification = false;
    const { summary, records } = buildBrowserUseRefreshQualification(receipts);
    expect(summary.decision).toBe('stop_before_certification');
    expect(summary.disqualifications).toContain('raw provider receipts are incomplete for 1/8 attempts; token and cost ranking prohibited');
    expect(records).toHaveLength(7);
  });

  it('rejects aggregate usage that disagrees with raw provider receipts', () => {
    const invalid = receipt('qualification', 'canonical', 1);
    invalid.usage!.input_tokens = 59;
    expect(() => buildBrowserUseRefreshQualification([invalid])).toThrow(/provider receipt completeness does not reconcile/);
  });

  it('rejects a hidden independent-oracle failure', () => {
    const invalid = receipt('qualification', 'canonical', 1);
    invalid.exact_live_verification = false;
    expect(() => buildBrowserUseRefreshQualification([invalid])).toThrow(/hides failed independent verification/);
  });
});
