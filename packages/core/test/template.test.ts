import { describe, it, expect } from 'vitest';
import { extractParamRefs, renderTemplate, UnboundParamError } from '../src/template.js';

describe('extractParamRefs', () => {
  it('finds refs nested in objects and arrays', () => {
    const value = {
      url: 'https://x/{{id}}',
      tags: ['{{env}}', 'static'],
      nested: { v: '{{amount}}' },
    };
    expect(extractParamRefs(value).sort()).toEqual(['amount', 'env', 'id']);
  });

  it('dedupes repeated references', () => {
    expect(extractParamRefs(['{{x}}', '{{x}}'])).toEqual(['x']);
  });

  it('ignores an escaped reference', () => {
    expect(extractParamRefs('literal \\{{not_a_param}}')).toEqual([]);
  });

  it('returns an empty array for a value with no references', () => {
    expect(extractParamRefs({ a: 1, b: [true, 'plain string'] })).toEqual([]);
  });
});

describe('renderTemplate', () => {
  it('substitutes a sole param reference and preserves its type', () => {
    expect(renderTemplate('{{amount}}', { amount: 42 })).toBe(42);
    expect(renderTemplate('{{flag}}', { flag: true })).toBe(true);
  });

  it('substitutes params embedded in a longer string as text', () => {
    expect(renderTemplate('https://x/{{id}}/edit', { id: 7 })).toBe('https://x/7/edit');
  });

  it('substitutes multiple references in one string', () => {
    expect(renderTemplate('{{a}}-{{b}}', { a: 1, b: 2 })).toBe('1-2');
  });

  it('recurses through arrays and objects', () => {
    const value = { url: 'https://x/{{id}}', tags: ['{{env}}'] };
    expect(renderTemplate(value, { id: 1, env: 'prod' })).toEqual({
      url: 'https://x/1',
      tags: ['prod'],
    });
  });

  it('throws UnboundParamError for a referenced-but-unbound param', () => {
    expect(() => renderTemplate('{{missing}}', {})).toThrow(UnboundParamError);
  });

  it('throws UnboundParamError even when the param is embedded in a longer string', () => {
    expect(() => renderTemplate('https://x/{{missing}}', {})).toThrow(UnboundParamError);
  });

  it('renders an escaped reference literally without requiring a binding', () => {
    expect(renderTemplate('\\{{literal}}', {})).toBe('{{literal}}');
  });

  it('leaves non-string, non-container values untouched', () => {
    expect(renderTemplate(42, {})).toBe(42);
    expect(renderTemplate(null, {})).toBe(null);
    expect(renderTemplate(true, {})).toBe(true);
  });
});
