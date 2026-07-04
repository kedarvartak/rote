import { describe, expect, it } from 'vitest';
import { initialWorldState, mergeWorldState, observationFromResult, observationFromText } from '../src/world-state.js';

describe('observationFromResult', () => {
  it('reads the documented convention fields from a tool result', () => {
    const obs = observationFromResult({
      url: 'https://x.com/dashboard',
      visible_selectors: ['#dashboard'],
      input_values: { '#username': 'alice' },
      visible_text: ['Welcome'],
    });
    expect(obs).toEqual({
      url: 'https://x.com/dashboard',
      visible_selectors: ['#dashboard'],
      input_values: { '#username': 'alice' },
      visible_text: ['Welcome'],
    });
  });

  it('returns an empty observation for a result with none of the convention fields', () => {
    expect(observationFromResult({ some: 'other', shape: 1 })).toEqual({});
  });

  it('returns an empty observation for a non-object result', () => {
    expect(observationFromResult('just a string')).toEqual({});
    expect(observationFromResult(null)).toEqual({});
  });
});

describe('observationFromText', () => {
  it('wraps LLM output as visible_text', () => {
    expect(observationFromText('hello')).toEqual({ visible_text: ['hello'] });
  });
});

describe('mergeWorldState', () => {
  it('persists a field an observation does not mention', () => {
    let state = initialWorldState();
    state = mergeWorldState(state, { visible_selectors: ['#login-form'] }, { visible_selectors: ['#login-form'] });
    state = mergeWorldState(state, {}, { some: 'unrelated result' });
    expect(state.visible_selectors).toEqual(['#login-form']);
  });

  it('merges input_values across steps rather than replacing wholesale', () => {
    let state = initialWorldState();
    state = mergeWorldState(state, { input_values: { '#first-name': 'alice' } }, {});
    state = mergeWorldState(state, { input_values: { '#last-name': 'anderson' } }, {});
    expect(state.input_values).toEqual({ '#first-name': 'alice', '#last-name': 'anderson' });
  });

  it('scopes last_json/last_output to the most recent step only', () => {
    let state = initialWorldState();
    state = mergeWorldState(state, {}, { first: true });
    state = mergeWorldState(state, {}, { second: true });
    expect(state.last_json).toEqual({ second: true });
  });
});
