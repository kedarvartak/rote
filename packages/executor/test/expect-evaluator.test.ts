import { describe, expect, it } from 'vitest';
import type { Expect } from '@rote/core';
import { evaluateExpect } from '../src/expect-evaluator.js';
import { initialWorldState, type WorldState } from '../src/world-state.js';

/**
 * One pass case + one fail case per Expect DSL primitive
 * (docs/06-build-plan.md M2 "Every expect primitive" — 10 primitives, 20 tests).
 */

function state(overrides: Partial<WorldState>): WorldState {
  return { ...initialWorldState(), ...overrides };
}

describe('evaluateExpect: exit_code', () => {
  const e: Expect = { exit_code: 0 };
  it('passes when exit_code matches', () => {
    expect(evaluateExpect(e, state({ last_exit_code: 0 })).pass).toBe(true);
  });
  it('fails when exit_code differs', () => {
    expect(evaluateExpect(e, state({ last_exit_code: 1 })).pass).toBe(false);
  });
});

describe('evaluateExpect: selector_visible', () => {
  const e: Expect = { selector_visible: '#dashboard' };
  it('passes when the selector is in visible_selectors', () => {
    expect(evaluateExpect(e, state({ visible_selectors: ['#dashboard'] })).pass).toBe(true);
  });
  it('fails when the selector is absent', () => {
    expect(evaluateExpect(e, state({ visible_selectors: ['#login'] })).pass).toBe(false);
  });
});

describe('evaluateExpect: selector_absent', () => {
  const e: Expect = { selector_absent: '#error-banner' };
  it('passes when the selector is not visible', () => {
    expect(evaluateExpect(e, state({ visible_selectors: ['#dashboard'] })).pass).toBe(true);
  });
  it('fails when the selector is still visible', () => {
    expect(evaluateExpect(e, state({ visible_selectors: ['#error-banner'] })).pass).toBe(false);
  });
});

describe('evaluateExpect: input_value', () => {
  const e: Expect = { input_value: '#username', equals: 'alice' };
  it('passes when the input value matches', () => {
    expect(evaluateExpect(e, state({ input_values: { '#username': 'alice' } })).pass).toBe(true);
  });
  it('fails when the input value differs', () => {
    expect(evaluateExpect(e, state({ input_values: { '#username': 'bob' } })).pass).toBe(false);
  });
});

describe('evaluateExpect: url_contains', () => {
  const e: Expect = { url_contains: '/dashboard' };
  it('passes when the url contains the substring', () => {
    expect(evaluateExpect(e, state({ url: 'https://x.com/dashboard' })).pass).toBe(true);
  });
  it('fails when the url does not contain the substring', () => {
    expect(evaluateExpect(e, state({ url: 'https://x.com/login' })).pass).toBe(false);
  });
});

describe('evaluateExpect: text_visible', () => {
  const e: Expect = { text_visible: 'Download complete' };
  it('passes when the text is present', () => {
    expect(evaluateExpect(e, state({ visible_text: ['Download complete'] })).pass).toBe(true);
  });
  it('fails when the text is absent', () => {
    expect(evaluateExpect(e, state({ visible_text: ['Still downloading'] })).pass).toBe(false);
  });
});

describe('evaluateExpect: json_path_exists', () => {
  const e: Expect = { json_path_exists: 'data.items[0].id' };
  it('passes when the path resolves', () => {
    expect(evaluateExpect(e, state({ last_json: { data: { items: [{ id: 1 }] } } })).pass).toBe(true);
  });
  it('fails when the path does not resolve', () => {
    expect(evaluateExpect(e, state({ last_json: { data: { items: [] } } })).pass).toBe(false);
  });
});

describe('evaluateExpect: json_path_equals', () => {
  const e: Expect = { json_path_equals: 'data.count', equals: 3 };
  it('passes when the resolved value equals', () => {
    expect(evaluateExpect(e, state({ last_json: { data: { count: 3 } } })).pass).toBe(true);
  });
  it('fails when the resolved value differs', () => {
    expect(evaluateExpect(e, state({ last_json: { data: { count: 4 } } })).pass).toBe(false);
  });
});

describe('evaluateExpect: output_matches', () => {
  const e: Expect = { output_matches: '^ok:\\d+$' };
  it('passes when the output matches the regex', () => {
    expect(evaluateExpect(e, state({ last_output: 'ok:42' })).pass).toBe(true);
  });
  it('fails when the output does not match', () => {
    expect(evaluateExpect(e, state({ last_output: 'error:42' })).pass).toBe(false);
  });
});

describe('evaluateExpect: nonempty', () => {
  const e: Expect = { nonempty: true };
  it('passes when last_json is non-empty', () => {
    expect(evaluateExpect(e, state({ last_json: { data: 'x' } })).pass).toBe(true);
  });
  it('fails when last_json is empty', () => {
    expect(evaluateExpect(e, state({ last_json: {} })).pass).toBe(false);
  });
});
