import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTrajectoryJsonl } from '@rote/core';
import type { TrajectoryEvent } from '@rote/core';
import { appendTrajectoryEvent } from '../src/trajectory-writer.js';

function event(seq: number): TrajectoryEvent {
  return {
    run_id: 'run-1',
    seq,
    ts: '2026-01-01T00:00:00.000Z',
    tool: 'echo',
    args: {},
    result_digest: { sha256: 'a'.repeat(64), byte_length: 4, preview: 'null' },
    result_ref: { kind: 'inline', value: null },
    duration_ms: 1,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rote-recorder-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('appendTrajectoryEvent', () => {
  it('appends events in call order, one JSON line each', async () => {
    const path = join(dir, 'trajectory.jsonl');
    await appendTrajectoryEvent(path, event(0));
    await appendTrajectoryEvent(path, event(1));
    await appendTrajectoryEvent(path, event(2));

    const text = await readFile(path, 'utf8');
    const events = parseTrajectoryJsonl(text);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('creates parent directories as needed', async () => {
    const path = join(dir, 'nested', 'runs', 'run-1', 'trajectory.jsonl');
    await appendTrajectoryEvent(path, event(0));
    const text = await readFile(path, 'utf8');
    expect(parseTrajectoryJsonl(text)).toHaveLength(1);
  });
});
