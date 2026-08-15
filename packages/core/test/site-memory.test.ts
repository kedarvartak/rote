import { describe, expect, it } from 'vitest';
import { pageKey, SiteMemoryRecordSchema, siteMemoryRecordKey } from '../src/index.js';

describe('site memory schema', () => {
  it('keys pages by origin+pathname digest only', () => {
    expect(pageKey('https://a.test/x/y?token=secret#frag')).toBe(pageKey('https://a.test/x/y'));
    expect(pageKey('https://a.test/x/y')).not.toBe(pageKey('https://a.test/x/z'));
    expect(pageKey('https://a.test/x')).toMatch(/^[0-9a-f]{16}$/);
    expect(pageKey('not a url')).toBeUndefined();
  });

  it('is strict and value-free: unknown fields and raw URLs do not parse', () => {
    const base = { version: 1, record_id: 'r', fingerprint_hash: 'fp', observed_at: '2026-08-16T00:00:00.000Z', run_id: 'run', source: 'observed', confidence: 1 };
    const record = { ...base, kind: 'selector_map', page_key: 'a'.repeat(16), stable_id: 'v2:' + 'b'.repeat(16), role: 'textbox', selector: '#x', strategy: 'stable-id' };
    expect(SiteMemoryRecordSchema.parse(record)).toEqual(record);
    expect(SiteMemoryRecordSchema.safeParse({ ...record, value: 'Acme' }).success).toBe(false);
    expect(SiteMemoryRecordSchema.safeParse({ ...record, page_key: 'https://a.test/x' }).success).toBe(false);
    expect(SiteMemoryRecordSchema.safeParse({ ...record, stable_id: '#company' }).success).toBe(false);
    expect(SiteMemoryRecordSchema.safeParse({ ...base, kind: 'quirk', code: 'free text from the page' }).success).toBe(false);
    expect(siteMemoryRecordKey(SiteMemoryRecordSchema.parse(record))).toBe(`selector_map|${'a'.repeat(16)}|v2:${'b'.repeat(16)}`);
  });
});
