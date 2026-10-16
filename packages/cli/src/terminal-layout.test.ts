import { describe, expect, it } from 'vitest';
import { characters, columns, clipColumns, wrapColumns } from './terminal-layout.js';

describe('terminal display columns', () => {
  it('clips wide text without splitting graphemes', () => {
    expect(clipColumns('界界abc', 3)).toBe('界');
    expect(characters('e\u0301👩‍💻')).toEqual(['e\u0301', '👩‍💻']);
    expect(clipColumns('👩‍💻ab', 3)).toBe('👩‍💻a');
  });
  it('keeps every wrapped line inside the available columns', () => {
    for (const width of [22, 26, 34, 74, 88]) {
      const text = '界👩‍💻e\u0301 abc '.repeat(40) + '\n\nlast';
      const lines = wrapColumns(text, width);
      expect(lines.every(line => columns(line) <= width)).toBe(true);
      expect(lines.join('')).toBe(text.replaceAll('\n', ''));
      expect(lines).toContain('');
    }
  });
});
