import { describe, expect, it } from 'vitest';
import { jsonPathExists, jsonPathGet } from '../src/json-path.js';

describe('jsonPathExists / jsonPathGet', () => {
  const value = { data: { items: [{ id: 1, tags: ['a', 'b'] }] }, count: 0 };

  it('resolves a nested object path', () => {
    expect(jsonPathExists(value, 'data.items[0].id')).toBe(true);
    expect(jsonPathGet(value, 'data.items[0].id')).toBe(1);
  });

  it('resolves an array element within a path', () => {
    expect(jsonPathGet(value, 'data.items[0].tags[1]')).toBe('b');
  });

  it('reports false for a path that does not resolve', () => {
    expect(jsonPathExists(value, 'data.items[5].id')).toBe(false);
    expect(jsonPathGet(value, 'data.items[5].id')).toBeUndefined();
  });

  it('distinguishes a present falsy value from a missing one', () => {
    expect(jsonPathExists(value, 'count')).toBe(true);
    expect(jsonPathGet(value, 'count')).toBe(0);
  });

  it('reports false when walking through a non-object', () => {
    expect(jsonPathExists(value, 'count.nested')).toBe(false);
  });
});
