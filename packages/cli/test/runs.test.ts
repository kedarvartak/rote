import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunManifest, TrajectoryEvent } from '@rote/core';
import { listRuns, showRun } from '../src/runs.js';

let baseDir: string;

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
  ended_at: '2026-01-01T00:00:05.000Z',
  token_usage: [],
};

const event: TrajectoryEvent = {
  run_id: 'run-1',
  seq: 0,
  ts: '2026-01-01T00:00:01.000Z',
  tool: 'echo',
  args: {},
  result_digest: { sha256: 'b'.repeat(64), byte_length: 4, preview: 'null' },
  result_ref: { kind: 'inline', value: null },
  duration_ms: 1,
};

async function seedRun(id: string, opts: { withManifest?: boolean } = {}) {
  const runDir = join(baseDir, 'runs', id);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'trajectory.jsonl'), `${JSON.stringify({ ...event, run_id: id })}\n`);
  if (opts.withManifest !== false) {
    await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ ...manifest, run_id: id }));
  }
}

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-cli-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('listRuns', () => {
  it('returns an empty list when no runs dir exists yet', async () => {
    expect(await listRuns(baseDir)).toEqual([]);
  });

  it('lists runs sorted by run_id, with manifests attached', async () => {
    await seedRun('run-b');
    await seedRun('run-a');
    const runs = await listRuns(baseDir);
    expect(runs.map((r) => r.run_id)).toEqual(['run-a', 'run-b']);
    expect(runs[0]?.manifest?.outcome).toBe('success');
  });

  it('lists a run with no manifest yet instead of omitting it', async () => {
    await seedRun('run-in-progress', { withManifest: false });
    const runs = await listRuns(baseDir);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.manifest).toBeUndefined();
  });
});

describe('showRun', () => {
  it('reads the manifest and full trajectory for one run', async () => {
    await seedRun('run-1');
    const detail = await showRun(baseDir, 'run-1');
    expect(detail.manifest?.run_id).toBe('run-1');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.tool).toBe('echo');
  });

  it('returns no events for a run that was never recorded', async () => {
    const detail = await showRun(baseDir, 'nonexistent');
    expect(detail.events).toEqual([]);
    expect(detail.manifest).toBeUndefined();
  });
});
