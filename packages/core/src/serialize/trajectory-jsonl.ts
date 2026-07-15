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
   * When true (default), a trailing line that is not valid, complete JSON is
   * silently dropped instead of raising. This is what makes an
   * append-per-event, fsync'd recorder crash-safe: a process killed
   * mid-write leaves a file that parses cleanly up to the last complete
   * event. See docs/05-roadmap.md M1 "Crash safety".
   */
  tolerateTrailingPartialLine?: boolean;
}

/** Parses JSON Lines trajectory text back into validated events. */
export function parseTrajectoryJsonl(
  text: string,
  options: ParseTrajectoryJsonlOptions = {},
): TrajectoryEvent[] {
  const { tolerateTrailingPartialLine = true } = options;
  const lines = text.split('\n').filter((line) => line.length > 0);
  const events: TrajectoryEvent[] = [];

  lines.forEach((line, index) => {
    const isLastLine = index === lines.length - 1;
    try {
      const parsed: unknown = JSON.parse(line);
      events.push(TrajectoryEventSchema.parse(parsed));
    } catch (cause) {
      if (isLastLine && tolerateTrailingPartialLine) {
        return;
      }
      throw new TrajectoryParseError(index + 1, cause);
    }
  });

  return events;
}
