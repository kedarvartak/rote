import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEnvFingerprint,
  writeTrajectoryJsonl,
  type RunManifest,
  type TokenUsage,
} from '@rote/core';
import { runPaths } from '@rote/recorder';
import { describe, expect, it } from 'vitest';
import {
  assembleHeadToHeadRecords,
  competitorRecordsFromRaw,
  type CompetitorRawRun,
} from '../src/headhead-assembler.js';
import { buildHeadToHead } from '../src/competitor.js';
import { evaluateLaunchGate } from '../src/competitor-gate.js';

// Writes a real `.rote/runs/<run_id>` artifact so the assembler reads it exactly
// as it would a run produced by `rote run` (fake-world first, docs/06).
async function writeRun(baseDir: string, runId: string, usage: TokenUsage[]): Promise<void> {
  const manifest: RunManifest = {
    run_id: runId,
    task_spec: 'B1: download report',
    env_fingerprint: buildEnvFingerprint({
      tool_inventory: [{ name: 'browser.click', schema_hash: 'abc' }],
      target_identity: 'demo.local',
      surface_versions: {},
    }),
    outcome: 'success',
    started_at: '2026-01-01T00:00:00.000Z',
    ended_at: '2026-01-01T00:00:01.000Z',
    token_usage: usage,
  };
  const paths = runPaths(baseDir, runId);
  await mkdir(paths.runDir, { recursive: true });
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(paths.trajectoryPath, writeTrajectoryJsonl([]), 'utf8');
}

async function scaffold(): Promise<{ dir: string; sourcesPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-assemble-'));
  const baseDir = join(dir, '.rote');
  const runs = [];
  for (let rep = 1; rep <= 2; rep += 1) {
    const runId = `b1-warm-${rep}`;
    // Two tagged sources that must sum into one neutral total per task.
    await writeRun(baseDir, runId, [
      { source: 'planner', input_tokens: 90 + rep, output_tokens: 10 },
      { source: 'verify', input_tokens: 5, output_tokens: 1 },
    ]);
    runs.push({ task: { id: 'B1', name: 'download report' }, phase: 'warm', repetition: rep, run_id: runId });
  }
  await writeFile(join(dir, 'bench-spec.json'), JSON.stringify({ base_dir: '.rote', runs }), 'utf8');

  const competitor = competitorRecordsFromRaw(
    [
      { task: 'B1', outcome: 'success', input_tokens: 400, output_tokens: 40, duration_ms: 2000 },
      { task: 'B1', outcome: 'success', input_tokens: 420, output_tokens: 45, duration_ms: 2100 },
    ] satisfies CompetitorRawRun[],
    { harness: 'browser-use', model: 'claude-opus-4-8', cache_adjusted: true },
  );
  await writeFile(join(dir, 'browser-use.json'), JSON.stringify(competitor), 'utf8');

  const sourcesPath = join(dir, 'sources.json');
  await writeFile(
    sourcesPath,
    JSON.stringify({
      subject: { spec: 'bench-spec.json', model: 'claude-opus-4-8', cache_adjusted: true },
      competitors: [{ harness: 'browser-use', records: 'browser-use.json' }],
    }),
    'utf8',
  );
  return { dir, sourcesPath };
}

describe('competitorRecordsFromRaw', () => {
  it('assigns per-task repetition indices and stamps fairness provenance', () => {
    const records = competitorRecordsFromRaw(
      [
        { task: 'B1', outcome: 'success', input_tokens: 400, output_tokens: 40, duration_ms: 2000 },
        { task: 'B1', outcome: 'failure', input_tokens: 100, output_tokens: 5, duration_ms: 500 },
        { task: 'B2', outcome: 'success', input_tokens: 300, output_tokens: 30, duration_ms: 1500 },
      ],
      { harness: 'browser-use', model: 'm', cache_adjusted: false, config_notes: 'default config' },
    );
    expect(records.map((r) => [r.task, r.repetition])).toEqual([['B1', 0], ['B1', 1], ['B2', 0]]);
    expect(records[0]).toMatchObject({ harness: 'browser-use', cache_adjusted: false, config_notes: 'default config' });
  });
});

describe('assembleHeadToHeadRecords', () => {
  it('sums recorded Rote run artifacts into neutral records and merges competitor sidecars', async () => {
    const { sourcesPath } = await scaffold();
    const records = await assembleHeadToHeadRecords(sourcesPath);

    const rote = records.filter((r) => r.harness === 'rote');
    expect(rote).toHaveLength(2);
    // rep 1: (90+1)+10 + (5+1) = 107; rep 2: (90+2)+10 + 6 = 108.
    expect(rote.map((r) => r.input_tokens + r.output_tokens).sort()).toEqual([107, 108]);
    expect(rote.every((r) => r.harness === 'rote' && r.model === 'claude-opus-4-8')).toBe(true);

    const bu = records.filter((r) => r.harness === 'browser-use');
    expect(bu).toHaveLength(2);

    // The assembled records feed the gate end to end.
    const result = buildHeadToHead(records);
    const gate = evaluateLaunchGate(result, { minRuns: 2 });
    expect(gate.comparisons[0].reduction.point).toBeGreaterThan(0.7);
    expect(gate.comparisons[0].success_parity).toBe(true);
  });

  it('rejects a competitor sidecar whose harness label disagrees with the source spec', async () => {
    const { dir, sourcesPath } = await scaffold();
    // Overwrite the sidecar with a mislabeled harness.
    const wrong = competitorRecordsFromRaw(
      [{ task: 'B1', outcome: 'success', input_tokens: 400, output_tokens: 40, duration_ms: 2000 }],
      { harness: 'stagehand', model: 'm', cache_adjusted: true },
    );
    await writeFile(join(dir, 'browser-use.json'), JSON.stringify(wrong), 'utf8');
    await expect(assembleHeadToHeadRecords(sourcesPath)).rejects.toThrow(/harness "stagehand"/);
  });
});
