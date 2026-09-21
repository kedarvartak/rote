import { isTruncatedJson } from './json-prefix.js';

/**
 * The recovery rule every append-only log in Rote shares.
 *
 * A process killed mid-append leaves a fragment of the record it was writing.
 * That fragment is dropped; anything else unparsable is corruption and must
 * surface (docs/05-roadmap.md M1 "Crash safety"; CLAUDE.md: never silently
 * wrong).
 *
 * The fragment is *not* always the last line. These logs are append-only and
 * never edited, so the next append writes a newline and continues after the
 * fragment, burying it mid-file — which is why the test is "is this a prefix of
 * something valid" ({@link isTruncatedJson}) rather than "is this the last
 * line" or "does it end in a brace".
 *
 * It lives here because four logs implement it: the trajectory, the playbook
 * library index, the site-memory partitions, and the continuation checkpoints.
 * Three of them tested the last byte for `}`, which is wrong in both directions:
 * `{"a":{"b":1}` ends in `}` and is a torn prefix, so a crash at that offset
 * made the log raise on every later read, while genuine garbage that happened
 * not to end in a brace was skipped without a word.
 */

/** Raised when a line of an append-only log is corrupt rather than torn. */
export class JsonlLineError extends Error {
  constructor(
    public readonly lineNumber: number,
    public readonly cause: unknown,
  ) {
    super(`Invalid JSON on line ${lineNumber}: ${String(cause)}`);
    this.name = 'JsonlLineError';
  }
}

export interface ParseJsonlOptions {
  /**
   * Where an interrupted write may appear.
   *
   * `'final-only'` (default) suits a log nothing appends to after the crash —
   * a run's trajectory belongs to one run, so its fragment is always last, and
   * a fragment anywhere else means the file was damaged after the fact.
   *
   * `'anywhere'` suits a long-lived shared log — the playbook library index,
   * a site-memory partition, the checkpoints for a task — where the next
   * append writes a newline and continues *after* the fragment rather than
   * editing it away, burying it mid-file.
   */
  tornFragments?: 'final-only' | 'anywhere' | 'none';
}

export interface ParsedJsonl {
  /** One parsed value per complete line, in file order. */
  values: unknown[];
  /** How many torn fragments were dropped — the caller may want to say so. */
  tornLines: number;
}

/**
 * Splits JSON Lines text into parsed values, applying the shared recovery rule.
 *
 * Schema validation is the caller's: this decides only what is *readable*, and
 * a line that parses as JSON but fails a schema is the caller's corruption to
 * report.
 */
export function parseJsonl(text: string, options: ParseJsonlOptions = {}): ParsedJsonl {
  const { tornFragments = 'final-only' } = options;
  const lines = text.split('\n');
  const values: unknown[] = [];
  let tornLines = 0;

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    try {
      values.push(JSON.parse(line));
    } catch (cause) {
      // INVARIANT: only an interrupted write is recoverable. A line that is not
      // a prefix of some valid record is a hole in an append-only log and may
      // not pass quietly.
      const isFinal = lines.slice(index + 1).every((rest) => rest.trim() === '');
      const recoverable = tornFragments === 'anywhere' || (tornFragments === 'final-only' && isFinal);
      if (recoverable && isTruncatedJson(line)) {
        tornLines += 1;
        continue;
      }
      throw new JsonlLineError(index + 1, cause);
    }
  }

  return { values, tornLines };
}
