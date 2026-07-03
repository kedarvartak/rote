import { describe, it, expect } from 'vitest';
import { ExpectSchema } from '../src/schemas/expect.js';

describe('ExpectSchema', () => {
  const validCases: unknown[] = [
    { exit_code: 0 },
    { selector_visible: '#invoice-table' },
    { selector_absent: '.error' },
    { input_value: '#amount', equals: '42' },
    { url_contains: '/invoices' },
    { text_visible: 'Invoice submitted' },
    { json_path_exists: '$.id' },
    { json_path_equals: '$.status', equals: 'ok' },
    { output_matches: '^ok$' },
    { nonempty: true },
  ];

  it.each(validCases)('accepts %j', (value) => {
    expect(ExpectSchema.safeParse(value).success).toBe(true);
  });

  it('rejects an unknown primitive', () => {
    expect(ExpectSchema.safeParse({ selector_exists_maybe: '#x' }).success).toBe(false);
  });

  it('rejects mixing two primitives in one object', () => {
    expect(ExpectSchema.safeParse({ exit_code: 0, nonempty: true }).success).toBe(false);
  });

  it('rejects extra unrelated keys alongside a valid primitive', () => {
    expect(ExpectSchema.safeParse({ selector_visible: '#x', extra: 'nope' }).success).toBe(false);
  });

  it('rejects nonempty: false (the primitive only accepts literal true)', () => {
    expect(ExpectSchema.safeParse({ nonempty: false }).success).toBe(false);
  });
});
