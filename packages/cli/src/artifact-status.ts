/**
 * Telling an artifact that is *absent* from one that is *unreadable*.
 *
 * Every read path in the CLI used to collapse both into "nothing here": a
 * corrupt trajectory rendered as a run with zero events, and a corrupt run was
 * dropped from the calibration sample without a word. That is the same failure
 * the store layer was fixed for (#209, #216) — surfacing corruption there is
 * worth nothing if the layer above catches it and shows an empty result.
 *
 * CLAUDE.md "Errors": never swallow an error into a boolean; a fallback path
 * logs *why* (classification), not just *that*.
 */

/** Why an artifact is not being shown. */
export type ArtifactStatus =
  | { kind: 'ok' }
  /** The file is not there — an in-progress run, or a feature never used. */
  | { kind: 'absent' }
  /** The file is there and could not be read: corruption, schema skew, or permissions. */
  | { kind: 'unreadable'; reason: string };

/** Whether a filesystem error means "not there" as opposed to "could not be read". */
export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/**
 * Classifies a read that may legitimately find nothing.
 *
 * `absent` is a normal outcome; anything else keeps its message, because the
 * message is the only thing that tells a person which file to look at.
 */
export async function readOptional<T>(read: () => Promise<T>): Promise<{ value?: T; status: ArtifactStatus }> {
  try {
    return { value: await read(), status: { kind: 'ok' } };
  } catch (error) {
    if (isMissing(error)) return { status: { kind: 'absent' } };
    return { status: { kind: 'unreadable', reason: error instanceof Error ? error.message : String(error) } };
  }
}

/** One line describing a non-ok status, for a report or a listing. */
export function describeStatus(what: string, status: ArtifactStatus): string | undefined {
  if (status.kind === 'ok') return undefined;
  if (status.kind === 'absent') return `${what}: (none)`;
  return `${what}: UNREADABLE — ${status.reason}`;
}
