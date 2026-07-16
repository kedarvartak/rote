import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEnvFingerprint, RunManifestSchema, parseTrajectoryJsonl } from '@rote/core';
import { FileBrowserAgentRunRecorder } from '../src/index.js';

let baseDir: string | undefined;

afterEach(async () => {
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
  baseDir = undefined;
});

describe('FileBrowserAgentRunRecorder', () => {
  it('writes append-only action events and a benchmark-compatible success manifest', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-agent-recorder-'));
    const recorder = new FileBrowserAgentRunRecorder({
      task: 'Open Alpha',
      envFingerprint: buildEnvFingerprint({
        tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }],
        target_identity: 'catalog.test',
        surface_versions: {},
      }),
      baseDir,
      runId: 'success-run',
      clock: sequenceClock(),
    });
    const usage = { source: 'planner' as const, input_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 4 };

    await recorder.recordStep({
      step: 0,
      action: { kind: 'click', selector: '#open-alpha', expect: { selector_visible: '#open-alpha' } },
      observation: { text: 'button Open Alpha', truncated: false, approxTokens: 4, mode: 'full' },
      usage,
      durationMs: 15,
      resolution: { selector: '#open-alpha', strategy: 'stable-id', stableId: 'aaaaaaaaaaaaaaaa' },
    });
    await recorder.finish('success', 'alpha opened', [usage]);

    const runDir = join(baseDir, 'runs', 'success-run');
    const events = parseTrajectoryJsonl(await readFile(join(runDir, 'trajectory.jsonl'), 'utf8'));
    const manifest = RunManifestSchema.parse(JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ seq: 0, tool: 'browser.click', duration_ms: 15 }));
    expect(events[0]?.result_ref).toEqual(expect.objectContaining({
      kind: 'inline',
      value: expect.objectContaining({
        resolution: { selector: '#open-alpha', strategy: 'stable-id', stableId: 'aaaaaaaaaaaaaaaa' },
      }),
    }));
    expect(manifest).toEqual(expect.objectContaining({
      run_id: 'success-run',
      task_spec: 'Open Alpha',
      outcome: 'success',
      token_usage: [usage],
    }));
  });
});

function sequenceClock(): () => Date {
  let time = Date.parse('2026-07-10T00:00:00.000Z');
  return () => {
    const current = new Date(time);
    time += 1;
    return current;
  };
}
