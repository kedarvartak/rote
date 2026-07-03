import { describe, it, expect } from 'vitest';
import { canonicalStringify, sha256Hex } from '../src/fingerprint.js';

describe('canonicalStringify', () => {
  it('produces identical output regardless of key order', () => {
    const a = { b: 1, a: 2, nested: { y: 1, x: 2 } };
    const b = { a: 2, nested: { x: 2, y: 1 }, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('preserves array order', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('produces different output when a value actually differs', () => {
    expect(canonicalStringify({ a: 1 })).not.toBe(canonicalStringify({ a: 2 }));
  });

  it('sorts keys recursively inside arrays of objects', () => {
    const a = [{ y: 1, x: 2 }];
    const b = [{ x: 2, y: 1 }];
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });
});

describe('sha256Hex', () => {
  it('is deterministic', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
  });

  it('differs for different input', () => {
    expect(sha256Hex('hello')).not.toBe(sha256Hex('world'));
  });

  it('matches a known test vector', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
