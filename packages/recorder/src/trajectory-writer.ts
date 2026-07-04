import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TrajectoryEvent } from '@rote/core';

/**
 * Appends one TrajectoryEvent as a JSONL line and fsyncs before returning.
 * INVARIANT: append-only, fsync per event — a process killed immediately
 * after this resolves leaves the file valid up to and including this line
 * (docs/06-build-plan.md M1 "Crash safety"; project invariant "everything
 * versioned"). Never opens the file for anything but append ('a').
 */
export async function appendTrajectoryEvent(path: string, event: TrajectoryEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'a');
  try {
    await handle.appendFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
