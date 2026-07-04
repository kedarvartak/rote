import { describe, expect, it } from 'vitest';
import { verifyInlineResultRef } from '@rote/core';
import { buildTrajectoryEvent } from '../src/build-trajectory-event.js';

const base = {
  run_id: 'run-1',
  seq: 0,
  ts: '2026-01-01T00:00:00.000Z',
  tool: 'echo',
  args: { text: 'hi' },
  duration_ms: 5,
  blobsDir: '.rote/runs/run-1/blobs',
};

describe('buildTrajectoryEvent', () => {
  it('inlines a small result and no blobWrite is produced', () => {
    const { event, blobWrite } = buildTrajectoryEvent({ ...base, result: { echoed: 'hi' } });
    expect(event.result_ref.kind).toBe('inline');
    expect(blobWrite).toBeUndefined();
    if (event.result_ref.kind === 'inline') {
      expect(verifyInlineResultRef(event.result_ref, event.result_digest)).toBe(true);
    }
  });

  it('spills a result over the inline threshold to a blob', () => {
    const big = 'x'.repeat(20000);
    const { event, blobWrite } = buildTrajectoryEvent({
      ...base,
      result: { data: big },
      inlineThresholdBytes: 100,
    });
    expect(event.result_ref.kind).toBe('blob');
    expect(blobWrite).toBeDefined();
    expect(blobWrite?.path).toContain(event.result_digest.sha256);
    expect(blobWrite?.contents).toBe(JSON.stringify({ data: big }));
  });

  it('records an error and treats result as absent', () => {
    const { event } = buildTrajectoryEvent({
      ...base,
      result: undefined,
      error: { message: 'boom', code: '-32000' },
    });
    expect(event.error).toEqual({ message: 'boom', code: '-32000' });
    expect(event.result_ref).toEqual({ kind: 'inline', value: undefined });
  });

  it('preserves seq and args exactly', () => {
    const { event } = buildTrajectoryEvent({ ...base, seq: 7, result: null });
    expect(event.seq).toBe(7);
    expect(event.args).toEqual({ text: 'hi' });
  });
});
