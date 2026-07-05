import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cellsFromSpec, parseBenchmarkSpec } from '../src/spec.js';
import { writeSyntheticBenchmarkPack } from '../src/synthetic.js';
import { buildBenchReport } from '../src/accounting.js';

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-bench-synthetic-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('writeSyntheticBenchmarkPack', () => {
  it('writes deterministic run artifacts, usage sidecars, spec, and report', async () => {
    const outDir = await tempDir();
    const pack = await writeSyntheticBenchmarkPack({
      outDir,
      tasks: [{ id: 'B1', name: 'download report' }],
      phases: ['cold', 'warm'],
      repetitions: 1,
    });

    const specText = await readFile(pack.specPath, 'utf8');
    const reportText = await readFile(pack.reportPath, 'utf8');
    const spec = parseBenchmarkSpec(JSON.parse(specText));
    const cells = await cellsFromSpec(spec, { specDir: outDir });
    const report = buildBenchReport(cells);

    expect(spec.runs).toEqual([
      expect.objectContaining({ phase: 'cold', run_id: 'b1-cold-1', usage_file: 'usage/b1-cold-1.json' }),
      expect.objectContaining({ phase: 'warm', run_id: 'b1-warm-1', usage_file: 'usage/b1-warm-1.json' }),
    ]);
    expect(cells).toHaveLength(2);
    expect(report.comparisons).toEqual([
      expect.objectContaining({ task: 'B1', token_reduction_ratio: 0.91, tool_call_reduction_ratio: 0.85 }),
    ]);
    expect(reportText).toContain('| B1 | 200000 | 18000 | 91.0% | 40 | 6 | 85.0% |');
  });

  it('is byte-stable for the same options', async () => {
    const first = await tempDir();
    const second = await tempDir();
    const options = { tasks: [{ id: 'B1', name: 'download report' }], phases: ['cold', 'warm'] as const, repetitions: 1 };
    const packA = await writeSyntheticBenchmarkPack({ outDir: first, ...options });
    const packB = await writeSyntheticBenchmarkPack({ outDir: second, ...options });

    await expect(readFile(packB.reportPath, 'utf8')).resolves.toBe(await readFile(packA.reportPath, 'utf8'));
    await expect(readFile(packB.specPath, 'utf8')).resolves.toBe(await readFile(packA.specPath, 'utf8'));
  });
});
