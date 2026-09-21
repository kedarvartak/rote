/**
 * Distinguishes a *torn* JSON fragment from corruption.
 *
 * An append-only log recovers from a process killed mid-write, and the fragment
 * it leaves does not stay at the end of the file: the next append writes a
 * newline and continues after it, because the log is never edited in place
 * (CLAUDE.md invariant 4). So "the last line may be broken" is not the rule —
 * the rule is that a *prefix of what was being written* is recoverable and
 * anything else is corruption, wherever in the file it sits.
 *
 * Testing the last byte for `}` gets this wrong in both directions:
 * `{"a":{"b":1}` ends in `}` and is a torn prefix, while `{"a":1 "b"` does not
 * and is genuine garbage.
 */

/**
 * Whether `text` is a strict prefix of some syntactically valid JSON document.
 *
 * Implemented by *completing* the fragment — closing an open string, finishing a
 * partial literal or number, dropping a dangling comma or key — and asking
 * `JSON.parse` whether the result is valid. Structural validity is therefore
 * decided by the real parser rather than by a hand-written one; the scanner
 * only tracks enough state to know what to append.
 */
export function isTruncatedJson(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed === '') return false;
  // A fragment that already parses is a complete record, not a torn one.
  if (parses(trimmed)) return false;

  const { stack, inString, danglingEscape } = scan(trimmed);
  const closers = [...stack].reverse().map((open) => (open === '{' ? '}' : ']')).join('');

  // Each candidate is a different guess at what the writer was in the middle
  // of; validity is decided by the real parser, never by this module. A
  // fragment no candidate rescues is corruption.
  // A write cut between a backslash and the character it escapes is still a
  // prefix of something valid — `"\\` completes to the string `\\`.
  const bases = danglingEscape
    ? [`${trimmed}\\"`, `${trimmed}\\":null`]
    : inString
      ? [`${trimmed}"`, `${trimmed}":null`]   // a cut value, or a cut key awaiting its value
      : [completeTail(trimmed), `${trimmed}:null`, trimmed];
  return bases.some((base) => base !== undefined && parses(base + closers));
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

interface ScanState {
  stack: string[];
  inString: boolean;
  danglingEscape: boolean;
}

function scan(text: string): ScanState {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') stack.pop();
  }
  // A cut between a backslash and the character it escapes is reported, not
  // rejected: it is still a prefix of something valid.
  return { stack, inString, danglingEscape: escaped };
}

/**
 * Trims a trailing token that a write was cut through — a dangling comma or
 * key, a partial `true`/`false`/`null`, or an unfinished number — so that
 * appending closers yields a parseable document.
 */
function completeTail(text: string): string | undefined {
  const body = text.trimEnd();
  const partialLiteral = /(?:^|[[{,:\s])(t|tr|tru|f|fa|fal|fals|n|nu|nul)$/.exec(body);
  if (partialLiteral) {
    const literal = partialLiteral[1]!.startsWith('t') ? 'true' : partialLiteral[1]!.startsWith('f') ? 'false' : 'null';
    return body.slice(0, body.length - partialLiteral[1]!.length) + literal;
  }
  // `1.`, `1e`, `-` and friends: finish the number rather than guess a value.
  if (/[-+.eE]$/.test(body)) return `${body}0`;
  // A dangling separator or key with no value yet: drop it.
  const dangling = /(?:,|,?\s*"(?:[^"\\]|\\.)*"\s*:)\s*$/.exec(body);
  if (dangling) return body.slice(0, dangling.index);
  return body;
}
