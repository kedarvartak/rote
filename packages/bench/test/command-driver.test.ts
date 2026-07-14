import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { parseCommandBenchmarkPlan, runCommandBenchmarkPlan } from '../src/command-driver.js';
import { parseBenchmarkSpec, cellsFromSpec } from '../src/spec.js';
import { roteRecordsFromCells } from '../src/competitor.js';

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-bench-command-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('command benchmark driver', () => {
  it('runs commands, validates artifacts, and writes a benchmark spec', async () => {
    const root = await tempDir();
    const script = await writeFakeRunScript(root);
    const planPath = join(root, 'plan.json');
    const outDir = join(root, 'out');
    await writeFile(
      planPath,
      JSON.stringify({
        runs: [
          { task: { id: 'B1', name: 'download report' }, phase: 'cold', repetition: 1, command: process.execPath, args: [script] },
          { task: { id: 'B1', name: 'download report' }, phase: 'warm', repetition: 1, command: process.execPath, args: [script, 'fail'] },
        ],
      }),
      'utf8',
    );

    const result = await runCommandBenchmarkPlan({ planPath, outDir });
    const spec = JSON.parse(await readFile(result.specPath, 'utf8')) as unknown;

    expect(spec).toEqual({
      base_dir: join(outDir, '.rote'),
      runs: [
        expect.objectContaining({ phase: 'cold', run_id: 'b1-cold-1', usage_file: 'usage/b1-cold-1.json' }),
        expect.objectContaining({ phase: 'warm', error: expect.stringContaining('command exited with code 2') }),
      ],
    });
    await expect(readFile(join(outDir, 'usage', 'b1-cold-1.json'), 'utf8')).resolves.toContain('planner');
  });

  it('exposes the command driver through rote-bench run', async () => {
    const root = await tempDir();
    const script = await writeFakeRunScript(root);
    const planPath = join(root, 'plan.json');
    const outDir = join(root, 'out');
    await writeFile(
      planPath,
      JSON.stringify({ runs: [{ task: { id: 'B1', name: 'download report' }, phase: 'cold', repetition: 1, command: process.execPath, args: [script] }] }),
      'utf8',
    );

    await expect(main(['run', planPath, '--out', outDir])).resolves.toBe(`wrote ${join(outDir, 'bench-spec.json')}`);
  });
});

describe('repetition fan-out', () => {
  const template = { task: { id: 'B1', name: 'download report' }, phase: 'cold', command: 'node' };

  it('expands a repetitions entry into N concrete runs with 1..N indices and auto-derived ids', () => {
    const plan = parseCommandBenchmarkPlan({ runs: [{ ...template, repetitions: 3 }] });
    expect(plan.runs).toHaveLength(3);
    expect(plan.runs.map((r) => r.repetition)).toEqual([1, 2, 3]);
    expect(plan.runs.every((r) => r.run_id === undefined && r.usage_file === undefined)).toBe(true);
  });

  it('preserves single-repetition entries and mixes them with fan-out entries', () => {
    const plan = parseCommandBenchmarkPlan({
      runs: [
        { ...template, repetition: 1 },
        { task: { id: 'B2', name: 'vendor form' }, phase: 'cold', command: 'node', repetitions: 2 },
      ],
    });
    expect(plan.runs.map((r) => `${r.task.id}-${r.repetition}`)).toEqual(['B1-1', 'B2-1', 'B2-2']);
  });

  it('rejects contradictory or ambiguous fan-out specs', () => {
    expect(() => parseCommandBenchmarkPlan({ runs: [{ ...template, repetition: 1, repetitions: 3 }] })).toThrow(/only one of repetition or repetitions/);
    expect(() => parseCommandBenchmarkPlan({ runs: [{ ...template, repetitions: 0 }] })).toThrow(/repetitions must be a positive integer/);
    expect(() => parseCommandBenchmarkPlan({ runs: [{ ...template, repetitions: 2, run_id: 'x' }] })).toThrow(/run_id is not allowed with repetitions/);
    expect(() => parseCommandBenchmarkPlan({ runs: [{ ...template, repetitions: 2, usage_file: 'u.json' }] })).toThrow(/usage_file is not allowed with repetitions/);
  });

  it('drives one command per repetition and yields enough Rote records for the launch gate', async () => {
    const root = await tempDir();
    const script = await writeFakeRunScript(root);
    const planPath = join(root, 'plan.json');
    const outDir = join(root, 'out');
    await writeFile(
      planPath,
      JSON.stringify({
        runs: [{ task: { id: 'B1', name: 'download report' }, phase: 'cold', command: process.execPath, args: [script], repetitions: 16 }],
      }),
      'utf8',
    );

    const result = await runCommandBenchmarkPlan({ planPath, outDir });
    expect(result.spec.runs).toHaveLength(16);
    expect(result.spec.runs.map((r) => (r as { run_id?: string }).run_id)).toContain('b1-cold-16');

    // The emitted spec feeds the head-to-head assembler bridge without hand-editing.
    const spec = parseBenchmarkSpec(JSON.parse(await readFile(result.specPath, 'utf8')));
    const cells = await cellsFromSpec(spec, { specDir: outDir });
    const records = roteRecordsFromCells(cells, { model: 'claude-opus-4-8', cacheAdjusted: true });
    expect(records).toHaveLength(16);
    expect(records.every((r) => r.harness === 'rote' && r.outcome === 'success')).toBe(true);
  });
});

async function writeFakeRunScript(root: string): Promise<string> {
  const script = join(root, 'fake-run.mjs');
  await writeFile(
    script,
    `import { createHash } from 'node:crypto';\nimport { mkdirSync, writeFileSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nif (process.argv[2] === 'fail') { console.error('planned failure'); process.exit(2); }\nconst runId = process.env.ROTE_RUN_ID;\nconst baseDir = process.env.ROTE_BASE_DIR;\nconst usageFile = process.env.ROTE_USAGE_FILE;\nconst runDir = join(baseDir, 'runs', runId);\nmkdirSync(runDir, { recursive: true });\nconst result = { ok: true };\nconst json = JSON.stringify(result);\nconst digest = { sha256: createHash('sha256').update(json).digest('hex'), byte_length: Buffer.byteLength(json), preview: json };\nconst event = { run_id: runId, seq: 0, ts: '2026-01-01T00:00:00.000Z', tool: 'fake.tool', args: {}, result_digest: digest, result_ref: { kind: 'inline', value: result }, duration_ms: 1 };\nconst manifest = { run_id: runId, task_spec: process.env.ROTE_TASK_SPEC, env_fingerprint: { tool_inventory: [], target_identity: 'fake', surface_versions: {}, fingerprint_hash: '0'.repeat(64) }, outcome: 'success', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-01T00:00:01.000Z', token_usage: [] };\nwriteFileSync(join(runDir, 'trajectory.jsonl'), JSON.stringify(event) + '\\n');\nwriteFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest) + '\\n');\nmkdirSync(dirname(usageFile), { recursive: true });\nwriteFileSync(usageFile, JSON.stringify([{ source: 'planner', input_tokens: 10, output_tokens: 5 }]) + '\\n');\n`,
    'utf8',
  );
  return script;
}
