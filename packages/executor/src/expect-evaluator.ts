import type { Expect } from '@rote/core';
import { jsonPathExists, jsonPathGet } from './json-path.js';
import type { WorldState } from './world-state.js';

export interface ExpectResult {
  pass: boolean;
  reason: string;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Evaluates one closed-DSL assertion against the executor's world state.
 * Pure — this is the "immune system" the build plan calls it
 * (docs/02-architecture.md): every primitive here must fail loudly with a
 * human-readable reason, never silently pass on a shape it doesn't
 * recognize. Exhaustive over `EXPECT_PRIMITIVE_NAMES`.
 */
export function evaluateExpect(expect: Expect, state: WorldState): ExpectResult {
  if ('exit_code' in expect) {
    const pass = state.last_exit_code === expect.exit_code;
    return { pass, reason: pass ? 'ok' : `exit_code was ${String(state.last_exit_code)}, expected ${expect.exit_code}` };
  }
  if ('selector_visible' in expect) {
    const pass = state.visible_selectors.includes(expect.selector_visible);
    return { pass, reason: pass ? 'ok' : `selector "${expect.selector_visible}" not visible` };
  }
  if ('selector_absent' in expect) {
    const pass = !state.visible_selectors.includes(expect.selector_absent);
    return { pass, reason: pass ? 'ok' : `selector "${expect.selector_absent}" is still visible` };
  }
  if ('input_value' in expect) {
    const actual = state.input_values[expect.input_value];
    const pass = actual === expect.equals;
    return {
      pass,
      reason: pass ? 'ok' : `input "${expect.input_value}" was "${String(actual)}", expected "${expect.equals}"`,
    };
  }
  if ('url_contains' in expect) {
    const pass = (state.url ?? '').includes(expect.url_contains);
    return { pass, reason: pass ? 'ok' : `url "${state.url ?? ''}" does not contain "${expect.url_contains}"` };
  }
  if ('text_visible' in expect) {
    const pass = state.visible_text.some((t) => t.includes(expect.text_visible));
    return { pass, reason: pass ? 'ok' : `text "${expect.text_visible}" not visible` };
  }
  if ('json_path_exists' in expect) {
    const pass = jsonPathExists(state.last_json, expect.json_path_exists);
    return { pass, reason: pass ? 'ok' : `json path "${expect.json_path_exists}" does not exist` };
  }
  if ('json_path_equals' in expect) {
    const actual = jsonPathGet(state.last_json, expect.json_path_equals);
    const pass = deepEqual(actual, expect.equals);
    return {
      pass,
      reason: pass
        ? 'ok'
        : `json path "${expect.json_path_equals}" was ${JSON.stringify(actual)}, expected ${JSON.stringify(expect.equals)}`,
    };
  }
  if ('output_matches' in expect) {
    const pass = new RegExp(expect.output_matches).test(state.last_output);
    return { pass, reason: pass ? 'ok' : `output does not match /${expect.output_matches}/` };
  }
  // 'nonempty' is the only remaining primitive (exhaustive union).
  const pass = !isEmpty(state.last_json);
  return { pass, reason: pass ? 'ok' : 'result was empty' };
}
