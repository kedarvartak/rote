import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isTruncatedJson } from '../src/serialize/json-prefix.js';

// The property that matters: a crash can cut a record at *any* byte, and every
// one of those cuts must read as torn rather than as corruption — otherwise an
// append-only log becomes permanently unreadable after a badly timed crash.

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
  object: fc.dictionary(fc.string({ minLength: 1 }), tie('value'), { maxKeys: 4 }),
})).value;

describe('isTruncatedJson', () => {
  it('reads every cut of a record as torn', () => {
    fc.assert(fc.property(jsonValue, fc.nat(), (value, cut) => {
      const text = JSON.stringify(value);
      fc.pre(text.length > 1);
      const prefix = text.slice(0, 1 + (cut % (text.length - 1)));
      fc.pre(prefix !== text);
      // A prefix that is *itself* complete JSON (e.g. `1` from `12`) never
      // reaches the recovery path, since it parses.
      fc.pre(!parses(prefix));
      expect(isTruncatedJson(prefix)).toBe(true);
    }), { numRuns: 500 });
  });

  it('does not mistake structural garbage for a torn write', () => {
    for (const corrupt of [
      '{"a":1 "b":2}',      // missing comma
      '{"a":1,,"b":2}',     // doubled comma
      '{"a" 1}',            // missing colon
      '{a:1}',              // unquoted key
      "{'a':1}",            // single quotes
      '{"a":01}',           // leading zero
      '[1,2]]',             // extra close
      'undefined',
      '@@@',
      '{"a":1}{"b":2}',     // two records on one line
    ]) {
      expect(isTruncatedJson(corrupt)).toBe(false);
    }
  });

  it('is false for a complete record, which never reaches the recovery path', () => {
    fc.assert(fc.property(jsonValue, (value) => {
      expect(isTruncatedJson(JSON.stringify(value))).toBe(false);
    }));
  });

  it.each([
    ['a nested object cut at a closing brace', '{"a":{"b":1}', true],
    ['a string cut mid-value', '{"run_id":"abc', true],
    ['a key with no value yet', '{"a":1,"b":', true],
    ['a dangling comma', '{"a":1,', true],
    ['a partial literal', '{"a":tru', true],
    ['an unfinished number', '{"a":1.', true],
    ['an unfinished exponent', '{"a":1e', true],
    ['an open array', '[1,2', true],
    ['nothing but an open brace', '{', true],
    ['a truncated top-level scalar', 'fals', true],
    ['a string cut after a completed escape', '{"a":"x\\\\', true],
    ['a string cut mid-escape, still a valid prefix', '{"a":"x\\', true],
    ['empty text', '', false],
  ])('%s', (_name, text, expected) => {
    expect(isTruncatedJson(text)).toBe(expected);
  });
});

function parses(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}
