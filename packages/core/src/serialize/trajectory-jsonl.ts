import { TrajectoryEventSchema, type TrajectoryEvent } from '../schemas/trajectory-event.js';
import { JsonlLineError, parseJsonl } from './jsonl.js';

/**
 * A JSON object key that cannot survive being read back into a record.
 *
 * `JSON.parse` gives `__proto__` an own property, but every schema library that
 * rebuilds a record by assignment — Zod included — loses it: `result[key] = v`
 * with that key sets the prototype instead of defining a property. The value is
 * discarded, not applied, so this is data loss rather than prototype pollution
 * (verified in #208). Either way an event that does not read back as it was
 * written must not pass quietly.
 */
const UNREPRESENTABLE_KEY = '__proto__';

/**
 * The path of the first key that would be lost on parse, or `undefined`.
 *
 * Exported because the property test needs to state the invariant as "either it
 * round-trips exactly, or it raises" — never silently in between.
 */
export function findUnrepresentableKey(value: unknown, path = '$'): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findUnrepresentableKey(item, `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  for (const key of Object.keys(value)) {
    if (key === UNREPRESENTABLE_KEY) return `${path}.${key}`;
    const found = findUnrepresentableKey((value as Record<string, unknown>)[key], `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

/** Raised when an event carries a key that could not be written and read back faithfully. */
export class TrajectoryKeyError extends Error {
  constructor(public readonly path: string) {
    super(`Key at ${path} cannot be recorded faithfully: "${UNREPRESENTABLE_KEY}" is lost when the event is read back (#208)`);
    this.name = 'TrajectoryKeyError';
  }
}

export class TrajectoryParseError extends Error {
  constructor(
    public readonly lineNumber: number,
    cause: unknown,
  ) {
    super(`Invalid trajectory event on line ${lineNumber}: ${String(cause)}`);
    this.name = 'TrajectoryParseError';
  }
}

/**
 * Serializes trajectory events as JSON Lines, one event per line.
 *
 * Refuses an event carrying a key the reader would lose, so this pair can never
 * produce a file it cannot read back. The live recorder appends with
 * `JSON.stringify` directly (`packages/recorder/src/trajectory-writer.ts`), so
 * this refusal cannot end a run in flight — sacred invariant 2 is untouched.
 */
export function writeTrajectoryJsonl(events: readonly TrajectoryEvent[]): string {
  if (events.length === 0) return '';
  for (const event of events) {
    const lost = findUnrepresentableKey(event);
    if (lost) throw new TrajectoryKeyError(lost);
  }
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

export interface ParseTrajectoryJsonlOptions {
  /**
   * When true (default), a trailing line that is not syntactically complete
   * JSON is dropped instead of raising. This is what makes an
   * append-per-event, fsync'd recorder crash-safe: a process killed
   * mid-write leaves a file that parses cleanly up to the last complete
   * event. See docs/05-roadmap.md M1 "Crash safety".
   *
   * It tolerates a *torn write* and nothing else. A final line that is
   * complete JSON but not a valid event is corruption, and raises like any
   * other line — see the note on {@link parseTrajectoryJsonl}.
   */
  tolerateTrailingPartialLine?: boolean;
}

/**
 * Parses JSON Lines trajectory text back into validated events.
 *
 * Crash tolerance is deliberately narrow. A process killed mid-append leaves a
 * final line that is *syntactically* incomplete, and that line is dropped. A
 * final line that is complete JSON but fails the event schema is corruption or
 * a version skew — never a torn write — and raises, because the last event of a
 * run is its terminal one: silently dropping it turns a run whose recorded
 * outcome is unreadable into a run that merely looks unfinished, which is the
 * shape of an invariant-1 failure (CLAUDE.md: never silently wrong).
 *
 * The sibling site-memory store states the same rule (`packages/site-memory/src/store.ts`).
 */
export function parseTrajectoryJsonl(
  text: string,
  options: ParseTrajectoryJsonlOptions = {},
): TrajectoryEvent[] {
  const { tolerateTrailingPartialLine = true } = options;
  // The torn-write rule is shared with the other three append-only logs; its
  // error is re-raised as this module's own so callers keep one type to catch.
  let values: unknown[];
  try {
    ({ values } = parseJsonl(text, { tornFragments: tolerateTrailingPartialLine ? 'final-only' : 'none' }));
  } catch (error) {
    if (error instanceof JsonlLineError) throw new TrajectoryParseError(error.lineNumber, error.cause);
    throw error;
  }
  return values.map((value, index) => {
    // Checked before the schema, which would drop the key and then report a
    // perfectly valid event — the silent half of the failure.
    const lost = findUnrepresentableKey(value);
    if (lost) throw new TrajectoryParseError(index + 1, new TrajectoryKeyError(lost));
    try {
      return TrajectoryEventSchema.parse(value);
    } catch (cause) {
      throw new TrajectoryParseError(index + 1, cause);
    }
  });
}
