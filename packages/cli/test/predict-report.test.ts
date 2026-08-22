import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPredictReport, main, predictReport } from '../src/index.js';

// see docs/testing/T39-predictor-systems.md — live calibration must be
// accumulated from recorded shadow predictions before any acting threshold is
// chosen. This suite pins the aggregation: T39-shaped buckets/thresholds,
// per-source counts, and zero invented samples.

const digest = { sha256: '0'.repeat(64), byte_length: 1, preview: '' };
const ts = '2026-08-22T00:00:00.000Z';

function line(runId: string, seq: number, result: unknown): string {
  return JSON.stringify({ run_id: runId, seq, ts, tool: 'browser.click', args: {}, result_digest: digest, result_ref: { kind: 'inline', value: result }, duration_ms: 5 });
}

async function writeRuns(runs: Record<string, string[]>): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), 'rote-predict-'));
  for (const [runId, lines] of Object.entries(runs)) {
    const dir = join(baseDir, 'runs', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'trajectory.jsonl'), lines.join('\n') + '\n');
  }
  return baseDir;
}

const prediction = (confidence: number, hit: boolean, source = 'trace') => ({ prediction: { confidence, source, hit } });

describe('rote predict-report', () => {
  it('reports an empty accumulator honestly', async () => {
    const baseDir = await writeRuns({ 'run-a': [line('run-a', 0, {})] });
    const report = await predictReport(baseDir);
    expect(report).toMatchObject({ runs: 1, runsWithPredictions: 0, shadowed: 0, hitRate: 0 });
    expect(formatPredictReport(report)).toContain('no predictions recorded yet');
  });

  it('accumulates buckets, sources, and thresholds across runs, T39-shaped', async () => {
    const baseDir = await writeRuns({
      'run-a': [
        line('run-a', 0, prediction(0.95, true)),
        line('run-a', 1, prediction(0.9, true)),
        line('run-a', 2, prediction(0.33, true, 'transition')),
        line('run-a', 3, {}),
      ],
      'run-b': [
        line('run-b', 0, prediction(0.85, false)),
        line('run-b', 1, prediction(1.0, true)),
      ],
    });
    const report = await predictReport(baseDir);
    expect(report).toMatchObject({ runs: 2, runsWithPredictions: 2, shadowed: 5, hits: 4 });
    expect(report.bySource).toEqual({ trace: { steps: 4, hits: 3 }, transition: { steps: 1, hits: 1 } });
    const top = report.calibration.find((bucket) => bucket.lower === 0.8)!;
    expect(top).toMatchObject({ steps: 4, hits: 3 });
    const low = report.calibration.find((bucket) => bucket.lower === 0.2)!;
    expect(low).toMatchObject({ steps: 1, hits: 1, hit_rate: 1 });
    const t9 = report.thresholds.find((row) => row.threshold === 0.9)!;
    expect(t9).toMatchObject({ acted: 3, hits: 3, precision: 1 });
    expect(t9.coverage).toBeCloseTo(3 / 5);
    const text = formatPredictReport(report);
    expect(text).toContain('overall: 4/5 hits (80.0%)');
    expect(text).toContain('≥0.9: 60.0% coverage, 100.0% precision (3/3)');
    expect(await main(['predict-report'], baseDir)).toContain('overall: 4/5');
  });
});
