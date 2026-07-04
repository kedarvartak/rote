import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTrajectoryJsonl } from '@rote/core';
import type { TrajectoryEvent } from '@rote/core';
import { appendTrajectoryEvent } from '../../src/trajectory-writer.js';

/**
 * Sacred invariant: "everything versioned — store mutations are append-only;
 * no in-place edits" (CLAUDE.md). This is the recorder's contribution to
 * the invariant suite — every PR touching the trajectory store must add or
 * strengthen a test here, not just add coverage elsewhere.
 */

function event(seq: number): TrajectoryEvent {
  return {
    run_id: 'run-1',
    seq,
    ts: '2026-01-01T00:00:00.000Z',
    tool: 'echo',
    args: { n: seq },
    result_digest: { sha256: 'a'.repeat(64), byte_length: 4, preview: 'null' },
    result_ref: { kind: 'inline', value: null },
    duration_ms: 1,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rote-recorder-invariant-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('trajectory store append-only invariant', () => {
  it('never rewrites a previously written line when a later event is appended', async () => {
    const path = join(dir, 'trajectory.jsonl');
    await appendTrajectoryEvent(path, event(0));
    const firstLineAfterOne = (await readFile(path, 'utf8')).split('\n')[0];

    await appendTrajectoryEvent(path, event(1));
    await appendTrajectoryEvent(path, event(2));
    const linesAfterThree = (await readFile(path, 'utf8')).split('\n');

    expect(linesAfterThree[0]).toBe(firstLineAfterOne);
    expect(linesAfterThree).toHaveLength(4); // 3 events + trailing empty string from final \n
  });

  it('a truncated final line (simulated crash mid-write) never corrupts earlier events', async () => {
    const path = join(dir, 'trajectory.jsonl');
    await appendTrajectoryEvent(path, event(0));
    await appendTrajectoryEvent(path, event(1));

    const intact = await readFile(path, 'utf8');
    const truncated = `${intact}{"run_id":"run-1","seq":2,"tool":"ec`; // cut mid-write

    const events = parseTrajectoryJsonl(truncated);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
  });
});
