import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const characters = (text: string): string[] => Array.from(segmenter.segment(text), item => item.segment);
export const columns = (text: string): number => stringWidth(text);

export function clipColumns(text: string, width: number): string {
  let result = '';
  for (const char of characters(text)) {
    if (columns(result + char) > width) break;
    result += char;
  }
  return result;
}

export function wrapColumns(text: string, width: number): string[] {
  return text.split('\n').flatMap(line => {
    const lines: string[] = [];
    let current = '';
    for (const char of characters(line)) {
      if (columns(current + char) > width) { lines.push(current); current = ''; }
      current += columns(char) <= width ? char : '';
    }
    lines.push(current);
    return lines;
  });
}
