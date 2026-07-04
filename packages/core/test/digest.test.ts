import { describe, it, expect } from 'vitest';
import {
  computeResultDigest,
  decideStorage,
  verifyInlineResultRef,
  DEFAULT_INLINE_THRESHOLD_BYTES,
} from '../src/digest.js';

describe('computeResultDigest', () => {
  it('is deterministic for the same value', () => {
    const a = computeResultDigest({ x: 1, y: [1, 2, 3] });
    const b = computeResultDigest({ x: 1, y: [1, 2, 3] });
    expect(a).toEqual(b);
  });

  it('differs when the value differs', () => {
    expect(computeResultDigest({ x: 1 }).sha256).not.toBe(computeResultDigest({ x: 2 }).sha256);
  });

  it('truncates preview for large values but keeps full byte_length and hash', () => {
    const big = 'x'.repeat(1000);
    const digest = computeResultDigest(big, 50);
    expect(digest.preview.length).toBeLessThan(60);
    expect(digest.byte_length).toBeGreaterThan(900);
  });
});

describe('decideStorage', () => {
  it('stores small results inline', () => {
    expect(decideStorage(100)).toBe('inline');
  });

  it('spills large results to blob', () => {
    expect(decideStorage(DEFAULT_INLINE_THRESHOLD_BYTES + 1)).toBe('blob');
  });

  it('is inclusive at the threshold boundary', () => {
    expect(decideStorage(DEFAULT_INLINE_THRESHOLD_BYTES)).toBe('inline');
  });
});

describe('verifyInlineResultRef', () => {
  it('accepts an untampered inline ref', () => {
    const value = { ok: true };
    const digest = computeResultDigest(value);
    expect(verifyInlineResultRef({ kind: 'inline', value }, digest)).toBe(true);
  });

  it('rejects a tampered inline ref', () => {
    const digest = computeResultDigest({ ok: true });
    expect(verifyInlineResultRef({ kind: 'inline', value: { ok: false } }, digest)).toBe(false);
  });
});
