import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalStringify, NonCanonicalValueError, sha256Hex } from '../src/fingerprint.js';
import { buildEnvFingerprint } from '../src/schemas/env-fingerprint.js';

// CLAUDE.md "Testing": property-based tests for fingerprinting. The example
// tests next door pin specific inputs; these pin the two properties the hard
// gate actually rests on — that key order never changes a hash, and that two
// environments which differ never share one (sacred invariant 3).

/** JSON values only: what a fingerprint input is allowed to contain. */
const jsonValue = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
    tie('array') as fc.Arbitrary<unknown>,
    tie('object') as fc.Arbitrary<unknown>,
  ),
  array: fc.array(tie('value'), { maxLength: 4 }),
  object: fc.dictionary(fc.string({ minLength: 1 }), tie('value'), { maxKeys: 5 }),
})).value;

/** Rebuilds a value with every object's keys in a different order. */
function shuffleKeys(value: unknown, rotate: number): unknown {
  if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, rotate));
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const offset = entries.length === 0 ? 0 : rotate % entries.length;
  const rotated = [...entries.slice(offset), ...entries.slice(0, offset)];
  const out: Record<string, unknown> = {};
  for (const [key, item] of rotated) out[key] = shuffleKeys(item, rotate);
  return out;
}

describe('canonicalStringify properties', () => {
  it('is blind to key order at every depth', () => {
    fc.assert(fc.property(jsonValue, fc.nat({ max: 8 }), (value, rotate) => {
      expect(canonicalStringify(shuffleKeys(value, rotate))).toBe(canonicalStringify(value));
    }));
  });

  it('gives one canonical form per value, and different forms to different values', () => {
    // The property a hard gate depends on: equal hashes must mean equal
    // environments. Two JSON values share a canonical string exactly when they
    // are the same value modulo key order.
    fc.assert(fc.property(jsonValue, jsonValue, (a, b) => {
      const same = canonicalStringify(a) === canonicalStringify(b);
      expect(same).toBe(JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b)));
    }));
  });

  it('is a fixed point: canonicalising its own output changes nothing', () => {
    fc.assert(fc.property(jsonValue, (value) => {
      const once = canonicalStringify(value);
      expect(canonicalStringify(JSON.parse(once))).toBe(once);
    }));
  });

  it('treats an absent key and an undefined one as the same statement', () => {
    fc.assert(fc.property(fc.dictionary(fc.string({ minLength: 1 }), jsonValue, { maxKeys: 4 }), fc.string({ minLength: 1 }), (base, key) => {
      fc.pre(!(key in base));
      expect(canonicalStringify({ ...base, [key]: undefined })).toBe(canonicalStringify(base));
    }));
  });

  it.each([
    ['a Date', { at: new Date(0) }, '$.at'],
    ['a Map', { m: new Map([['k', 'v']]) }, '$.m'],
    ['a Set', { s: new Set([1]) }, '$.s'],
    ['NaN', { n: Number.NaN }, '$.n'],
    ['Infinity', { n: Number.POSITIVE_INFINITY }, '$.n'],
    ['a bigint', { b: 1n }, '$.b'],
    ['a function', { f: () => 1 }, '$.f'],
    ['a symbol', { s: Symbol('x') }, '$.s'],
    ['undefined inside an array', { a: [undefined] }, '$.a[0]'],
    ['a class instance', { e: new Error('x') }, '$.e'],
  ])('refuses to hash %s, naming where it is', (_name, value, path) => {
    // Each of these has a JSON.stringify image that belongs to some *other*
    // value: a Date and a Map both become {}, NaN and Infinity both become
    // null, an undefined array element becomes null. Approximating any of them
    // hands two different environments the same fingerprint.
    expect(() => canonicalStringify(value)).toThrow(NonCanonicalValueError);
    try {
      canonicalStringify(value);
    } catch (error) {
      expect((error as NonCanonicalValueError).path).toBe(path);
    }
  });

  it('does not confuse a Date with an empty object, which is what it used to hash as', () => {
    expect(canonicalStringify({})).toBe('{}');
    expect(() => canonicalStringify(new Date(0))).toThrow(NonCanonicalValueError);
  });
});

describe('environment fingerprint properties', () => {
  const inventory = fc.uniqueArray(
    fc.record({ name: fc.string({ minLength: 1 }), schema_hash: fc.hexaString({ minLength: 4, maxLength: 8 }) }),
    { selector: (entry) => entry.name, maxLength: 6 },
  );

  it('does not depend on the order tools were discovered in', () => {
    fc.assert(fc.property(inventory, fc.string({ minLength: 1 }), fc.nat({ max: 6 }), (tools, identity, rotate) => {
      const offset = tools.length === 0 ? 0 : rotate % tools.length;
      const rotated = [...tools.slice(offset), ...tools.slice(0, offset)];
      expect(buildEnvFingerprint({ tool_inventory: rotated, target_identity: identity, surface_versions: {} }).fingerprint_hash)
        .toBe(buildEnvFingerprint({ tool_inventory: tools, target_identity: identity, surface_versions: {} }).fingerprint_hash);
    }));
  });

  it('separates any two environments that differ at all', () => {
    // INVARIANT: sacred invariant 3 — a fingerprint mismatch short-circuits
    // before any fuzzy matching, which is only safe if differing environments
    // actually mismatch.
    fc.assert(fc.property(inventory, inventory, fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (a, b, idA, idB) => {
      const left = { tool_inventory: a, target_identity: idA, surface_versions: {} };
      const right = { tool_inventory: b, target_identity: idB, surface_versions: {} };
      const identical = canonicalStringify(sortByName(left)) === canonicalStringify(sortByName(right));
      expect(buildEnvFingerprint(left).fingerprint_hash === buildEnvFingerprint(right).fingerprint_hash).toBe(identical);
    }));
  });

  it('produces a lowercase 64-character hex hash for any input', () => {
    fc.assert(fc.property(inventory, fc.string({ minLength: 1 }), (tools, identity) => {
      expect(buildEnvFingerprint({ tool_inventory: tools, target_identity: identity, surface_versions: {} }).fingerprint_hash)
        .toMatch(/^[0-9a-f]{64}$/);
    }));
  });

  it('hashes distinct strings to distinct digests', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => {
      expect(sha256Hex(a) === sha256Hex(b)).toBe(a === b);
    }));
  });
});

function sortByName(input: { tool_inventory: { name: string; schema_hash: string }[]; target_identity: string; surface_versions: Record<string, string> }) {
  return { ...input, tool_inventory: [...input.tool_inventory].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Independent reference implementation of "same value modulo key order". */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortDeep((value as Record<string, unknown>)[key]);
  }
  return out;
}
