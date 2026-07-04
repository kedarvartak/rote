import {
  computeResultDigest,
  decideStorage,
  DEFAULT_INLINE_THRESHOLD_BYTES,
  type TrajectoryEvent,
} from '@rote/core';
import { blobPath } from './run-paths.js';

export interface BuildTrajectoryEventInput {
  run_id: string;
  seq: number;
  ts: string;
  tool: string;
  args: Record<string, unknown>;
  /** The raw tool result, or undefined if the call errored. */
  result: unknown;
  duration_ms: number;
  error?: { message: string; code?: string };
  blobsDir: string;
  inlineThresholdBytes?: number;
}

export interface BuildTrajectoryEventOutput {
  event: TrajectoryEvent;
  /** Present only when the result was decided as blob-stored; the recorder writes these bytes. */
  blobWrite?: { path: string; contents: string };
}

/**
 * Builds one TrajectoryEvent from a correlated tool call + result, deciding
 * inline vs. blob storage by size. Pure — the actual blob file write is the
 * caller's (I/O) responsibility (see blob-store.ts). This is what M1's
 * "large results" and "passthrough on failure" tests exercise directly,
 * without spinning up a process. See docs/06-build-plan.md M1.
 */
export function buildTrajectoryEvent(input: BuildTrajectoryEventInput): BuildTrajectoryEventOutput {
  const threshold = input.inlineThresholdBytes ?? DEFAULT_INLINE_THRESHOLD_BYTES;
  const digest = computeResultDigest(input.result);
  const storage = decideStorage(digest.byte_length, threshold);

  if (storage === 'inline') {
    return {
      event: {
        run_id: input.run_id,
        seq: input.seq,
        ts: input.ts,
        tool: input.tool,
        args: input.args,
        result_digest: digest,
        result_ref: { kind: 'inline', value: input.result },
        duration_ms: input.duration_ms,
        error: input.error,
      },
    };
  }

  const path = blobPath(input.blobsDir, digest.sha256);
  return {
    event: {
      run_id: input.run_id,
      seq: input.seq,
      ts: input.ts,
      tool: input.tool,
      args: input.args,
      result_digest: digest,
      result_ref: { kind: 'blob', path },
      duration_ms: input.duration_ms,
      error: input.error,
    },
    blobWrite: { path, contents: JSON.stringify(input.result) },
  };
}
