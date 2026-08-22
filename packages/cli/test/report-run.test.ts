import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { formatRunReport, main, reportRun } from '../src/index.js';

// see docs/03 "Metrics" — all token counts are per-source-tagged (invariant 5)
// so the report shows which component spent what. This suite pins that the
// aggregation is exact, prefers the manifest's authoritative usage, and never
// invents data for a run that recorded none.

const digest = { sha256: '0'.repeat(64), byte_length: 1, preview: '' };
const ts = '2026-08-22T00:00:00.000Z';

function line(seq: number, tool: string, result: unknown, error?: string): string {
  return JSON.stringify({
    run_id: 'run-r1', seq, ts, tool, args: {}, result_digest: digest,
    result_ref: { kind: 'inline', value: result }, duration_ms: 5,
    ...(error ? { error: { message: error } } : {}),
  });
}

async function writeRun(events: string[], manifest?: object): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), 'rote-report-'));
  const runDir = join(baseDir, 'runs', 'run-r1');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'trajectory.jsonl'), events.join('\n') + '\n');
  if (manifest) await writeFile(join(runDir, 'manifest.json'), JSON.stringify(manifest));
  return baseDir;
}

const usage = (source: string, input: number, output: number, cacheRead = 0) => ({
  source, input_tokens: input, output_tokens: output,
  ...(cacheRead ? { cache_read_tokens: cacheRead } : {}),
});

describe('rote report', () => {
  it('decomposes a run by source and summarizes routing, shadow prediction, and settles', async () => {
    const baseDir = await writeRun([
      line(0, 'browser.navigate', { planner_usage: usage('planner', 100, 10), settle_ms: 120, route: { planner: 'frontier', reason: 'no_confident_prediction' } }),
      line(1, 'browser.fill', {
        planner_usage: [usage('planner', 50, 5, 1024), usage('repair', 20, 2)],
        escalation_usage: [usage('planner', 30, 3)],
        settle_ms: 40,
        route: { planner: 'routine', reason: 'confident_prediction', escalated: true },
        prediction: { confidence: 0.95, source: 'trace', hit: true },
      }),
      line(2, 'browser.fill', { planner_usage: usage('planner', 60, 6), settle_ms: 80, prediction: { confidence: 0.4, source: 'transition', hit: false } }),
      line(3, 'browser.click', {}, 'could not resolve browser target'),
      line(4, 'browser.done', { verification: { success: true, checks: [] } }),
    ]);
    const report = await reportRun(baseDir, 'run-r1');

    expect(report.outcome).toBeUndefined();
    expect(report.steps).toBe(5);
    // the errored click and the terminal done are not dispatched actions
    expect(report.dispatchedSteps).toBe(3);
    expect(report.usage).toEqual([
      { source: 'planner', calls: 4, input_tokens: 240, output_tokens: 24, cache_read_tokens: 1024, cache_write_tokens: 0, logical_input_tokens: 1264 },
      { source: 'repair', calls: 1, input_tokens: 20, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, logical_input_tokens: 20 },
    ]);
    expect(report.routing).toEqual({ routine: 1, frontier: 1, escalated: 1 });
    expect(report.prediction).toMatchObject({ shadowed: 2, hits: 1, hitRate: 0.5 });
    expect(report.settle).toEqual([
      { action_kind: 'fill', samples: 2, p50_ms: 40, p90_ms: 80, max_ms: 80 },
      { action_kind: 'navigate', samples: 1, p50_ms: 120, p90_ms: 120, max_ms: 120 },
    ]);
    const text = formatRunReport(report);
    expect(text).toContain('no manifest');
    expect(text).toContain('planner: 4 calls, 1264 logical input');
    expect(text).toContain('routing: 1 routine, 1 frontier, 1 escalated');
  });

  it('prefers the manifest\'s authoritative token usage over per-step records', async () => {
    const baseDir = await writeRun(
      [line(0, 'browser.navigate', { planner_usage: usage('planner', 999, 99) })],
      {
        run_id: 'run-r1', task_spec: 'demo task', outcome: 'success', started_at: ts,
        env_fingerprint: { tool_inventory: [], target_identity: 'fixture.test', fingerprint_hash: 'a'.repeat(64) },
        token_usage: [usage('planner', 100, 10), usage('verify', 40, 4)],
      },
    );
    const report = await reportRun(baseDir, 'run-r1');
    expect(report.outcome).toBe('success');
    expect(report.usage.map((row) => [row.source, row.logical_input_tokens])).toEqual([['planner', 100], ['verify', 40]]);
  });

  it('reports a run that recorded nothing without inventing data, and is wired into the CLI', async () => {
    const baseDir = await writeRun([line(0, 'browser.navigate', {})]);
    const report = await reportRun(baseDir, 'run-r1');
    expect(report.usage).toEqual([]);
    expect(report.prediction).toBeUndefined();
    expect(report.routing).toBeUndefined();
    expect(report.settle).toEqual([]);
    expect(formatRunReport(report)).toContain('tokens: none recorded');

    const out = await main(['report', 'run-r1'], baseDir);
    expect(out).toContain('run run-r1');
    await expect(main(['report'], baseDir)).rejects.toThrow(/usage: rote report/);
  });
});
