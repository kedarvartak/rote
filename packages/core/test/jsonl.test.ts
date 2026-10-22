import { describe, expect, it } from 'vitest';
import { JsonlLineError, parseJsonl } from '../src/serialize/jsonl.js';

const record = (n: number) => JSON.stringify({ seq: n, nested: { deep: n } });

describe('parseJsonl', () => {
  it('reads a clean log', () => {
    const { values, tornLines } = parseJsonl(`${record(0)}\n${record(1)}\n`);
    expect(values).toHaveLength(2);
    expect(tornLines).toBe(0);
  });

  it('recovers a torn fragment that a later append buried mid-file', () => {
    // The defect this replaced: these logs are never edited, so the append
    // after a crash writes a newline and continues *after* the fragment. A
    // rule that only forgives the last line makes such a log raise forever.
    const text = `${record(0)}\n{"seq":1,"nested":{"deep":1}\n${record(2)}\n`;
    const { values, tornLines } = parseJsonl(text, { tornFragments: 'anywhere' });
    expect(values).toEqual([JSON.parse(record(0)), JSON.parse(record(2))]);
    expect(tornLines).toBe(1);
  });

  it('recovers a fragment that ends in a closing brace', () => {
    // `{"a":{"b":1}` ends in "}" and is incomplete. Testing the last byte, as
    // three stores did, called this corruption and refused the whole log.
    const { values, tornLines } = parseJsonl(`{"seq":0,"nested":{"deep":0}\n${record(1)}\n`, { tornFragments: 'anywhere' });
    expect(values).toEqual([JSON.parse(record(1))]);
    expect(tornLines).toBe(1);
  });

  it('raises on garbage that merely fails to end in a brace', () => {
    // ...and the same last-byte test skipped this without a word.
    expect(() => parseJsonl(`${record(0)}\n{"seq":1 "nested":2}\n`, { tornFragments: 'anywhere' }))
      .toThrow(JsonlLineError);
  });

  it.each([
    ['a doubled comma', '{"seq":1,,"nested":2}'],
    ['an unquoted key', '{seq:1}'],
    ['two records on one line', '{"seq":1}{"seq":2}'],
    ['trailing junk after a record', '{"seq":1} oops'],
  ])('raises on %s wherever tolerance is set', (_name, corrupt) => {
    for (const tornFragments of ['anywhere', 'final-only'] as const) {
      expect(() => parseJsonl(`${record(0)}\n${corrupt}\n`, { tornFragments })).toThrow(JsonlLineError);
    }
  });

  it('reports the line number of the corruption', () => {
    try {
      parseJsonl(`${record(0)}\n${record(1)}\n{"a" 1}\n`);
      expect.unreachable('expected a JsonlLineError');
    } catch (error) {
      expect((error as JsonlLineError).lineNumber).toBe(3);
    }
  });

  it('refuses every fragment when tolerance is off', () => {
    expect(() => parseJsonl(`${record(0)}\n{"seq":1`, { tornFragments: 'none' })).toThrow(JsonlLineError);
  });

  it('only forgives the last line by default', () => {
    expect(parseJsonl(`${record(0)}\n{"seq":1`).values).toHaveLength(1);
    expect(() => parseJsonl(`{"seq":1\n${record(0)}\n`)).toThrow(JsonlLineError);
  });

  it('ignores blank lines without counting them as torn', () => {
    expect(parseJsonl(`${record(0)}\n\n\n${record(1)}\n`)).toEqual({
      values: [JSON.parse(record(0)), JSON.parse(record(1))],
      tornLines: 0,
    });
  });
});
