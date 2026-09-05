import { TrajectoryEventSchema, type TrajectoryEvent } from '../schemas/trajectory-event.js';

export class TrajectoryParseError extends Error {
  constructor(
    public readonly lineNumber: number,
    cause: unknown,
  ) {
    super(`Invalid trajectory event on line ${lineNumber}: ${String(cause)}`);
    this.name = 'TrajectoryParseError';
  }
}

/** Serializes trajectory events as JSON Lines, one event per line. */
export function writeTrajectoryJsonl(events: readonly TrajectoryEvent[]): string {
  if (events.length === 0) return '';
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
  const lines = text.split('\n').filter((line) => line.length > 0);
  const events: TrajectoryEvent[] = [];

  lines.forEach((line, index) => {
    const isLastLine = index === lines.length - 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      // INVARIANT: only an incomplete write is recoverable.
      if (isLastLine && tolerateTrailingPartialLine) return;
      throw new TrajectoryParseError(index + 1, cause);
    }
    try {
      events.push(TrajectoryEventSchema.parse(parsed));
    } catch (cause) {
      throw new TrajectoryParseError(index + 1, cause);
    }
  });

  return events;
}
