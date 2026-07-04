import { describe, expect, it } from 'vitest';
import type { RunManifest, TrajectoryEvent } from '@rote/core';
import { formatRunDetail, formatRunsList } from '../src/format.js';

const manifest: RunManifest = {
  run_id: 'run-1',
  task_spec: 'B1: download report',
  env_fingerprint: {
    tool_inventory: [],
    target_identity: 'demo.example.com',
    surface_versions: {},
    fingerprint_hash: 'a'.repeat(64),
  },
  outcome: 'success',
  started_at: '2026-01-01T00:00:00.000Z',
  token_usage: [],
};

describe('formatRunsList', () => {
  it('reports no runs found for an empty list', () => {
    expect(formatRunsList([])).toBe('No runs found.');
  });

  it('shows in-progress for a run with no manifest yet', () => {
    const output = formatRunsList([{ run_id: 'run-1' }]);
    expect(output).toContain('in-progress');
  });

  it('includes outcome and task_spec for a completed run', () => {
    const output = formatRunsList([{ run_id: 'run-1', manifest }]);
    expect(output).toContain('success');
    expect(output).toContain('B1: download report');
  });
});

describe('formatRunDetail', () => {
  it('lists every event with tool, args, and status', () => {
    const event: TrajectoryEvent = {
      run_id: 'run-1',
      seq: 0,
      ts: '2026-01-01T00:00:01.000Z',
      tool: 'echo',
      args: { greeting: 'hi' },
      result_digest: { sha256: 'b'.repeat(64), byte_length: 4, preview: 'null' },
      result_ref: { kind: 'inline', value: null },
      duration_ms: 3,
    };
    const output = formatRunDetail({ run_id: 'run-1', manifest, events: [event] });
    expect(output).toContain('echo({"greeting":"hi"}) -> ok (3ms)');
  });

  it('surfaces an error event distinctly from a successful one', () => {
    const event: TrajectoryEvent = {
      run_id: 'run-1',
      seq: 0,
      ts: '2026-01-01T00:00:01.000Z',
      tool: 'fail',
      args: {},
      result_digest: { sha256: 'c'.repeat(64), byte_length: 4, preview: 'null' },
      result_ref: { kind: 'inline', value: null },
      duration_ms: 1,
      error: { message: 'boom' },
    };
    const output = formatRunDetail({ run_id: 'run-1', manifest, events: [event] });
    expect(output).toContain('error: boom');
  });

  it('notes a missing manifest instead of crashing', () => {
    const output = formatRunDetail({ run_id: 'run-1', events: [] });
    expect(output).toContain('manifest: (none yet');
  });
});
