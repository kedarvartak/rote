import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { readCompetitorRecords } from '../src/competitor.js';
import { competitorRecordsFromRaw, readCompetitorRawRuns } from '../src/headhead-assembler.js';

// Resolved from this file, not the cwd, so the suite passes wherever vitest runs.
const headhead = (path: string): string => fileURLToPath(new URL(`../../../scripts/bench/headhead/${path}`, import.meta.url));
const RAW_RUNS = headhead('browser-use/raw-runs.example.json');

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-browser-use-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

// The runner itself is out-of-process Python and never runs in CI (same pattern as
// the serializer captures). What CI must guarantee is that the shape it emits is
// ingested exactly, so a real capture cannot fail late during a benchmark run.
describe('browser-use adapter ingestion', () => {
  it('maps the runner raw output onto neutral records field by field', async () => {
    const raw = await readCompetitorRawRuns(RAW_RUNS);
    const records = competitorRecordsFromRaw(raw, {
      harness: 'browser-use',
      model: 'claude-opus-4-8',
      cache_adjusted: true,
      config_notes: 'browser-use 0.13.4, defaults',
    });

    expect(records[0]).toEqual({
      harness: 'browser-use',
      task: 'B1',
      phase: 'cold',
      repetition: 0,
      outcome: 'success',
      input_tokens: 41230,
      output_tokens: 1840,
      duration_ms: 28400,
      model: 'claude-opus-4-8',
      cache_adjusted: true,
      config_notes: 'browser-use 0.13.4, defaults',
    });
    // Non-success runs survive the mapping; the gate reads them as parity misses
    // rather than dropping them (a dropped failure would flatter the competitor).
    expect(records.map((r) => r.outcome)).toEqual(['success', 'success', 'failure', 'success', 'abandoned']);
    expect(records.every((r) => r.harness === 'browser-use' && r.model === 'claude-opus-4-8')).toBe(true);
  });

  it('rejects a raw run that cannot report its tokens instead of recording zero', async () => {
    const dir = await tempDir();
    const path = join(dir, 'raw-runs.json');
    await writeFile(path, JSON.stringify([{ task: 'B1', outcome: 'success', duration_ms: 100 }]), 'utf8');
    await expect(readCompetitorRawRuns(path)).rejects.toThrow();
  });

  it('writes a sidecar the head-to-head records step reads back', async () => {
    const dir = await tempDir();
    const out = join(dir, 'browser-use.json');
    const message = await main([
      'competitor-records', RAW_RUNS,
      '--harness', 'browser-use',
      '--model', 'claude-opus-4-8',
      '--cache-adjusted', 'true',
      '--config-notes', 'browser-use 0.13.4, defaults',
      '--out', out,
    ]);

    expect(message).toBe(`wrote ${out} (5 browser-use records)`);
    const records = await readCompetitorRecords(out);
    expect(records).toHaveLength(5);
    expect(records.every((r) => r.cache_adjusted && r.config_notes === 'browser-use 0.13.4, defaults')).toBe(true);
  });

  it('requires fairness provenance rather than defaulting it', async () => {
    await expect(main(['competitor-records', RAW_RUNS, '--harness', 'browser-use', '--model', 'm'])).rejects.toThrow(
      /--cache-adjusted <true\|false>/,
    );
    await expect(
      main(['competitor-records', RAW_RUNS, '--harness', 'browser-use', '--model', 'm', '--cache-adjusted', 'yes']),
    ).rejects.toThrow('--cache-adjusted must be true or false');
  });
});

// Fairness rule from docs/03: both harnesses must be given the same task. That is
// only true if the Rote plan and the Browser Use runner read the same prompts, so
// it is checked here rather than asserted in prose.
describe('head-to-head task parity', () => {
  it('gives Rote and Browser Use identical prompts, URLs and verification text', async () => {
    const config = JSON.parse(await readFile(headhead('tasks.json'), 'utf8')) as {
      model: string;
      fixture_port: number;
      repetitions: number;
      tasks: Array<{ id: string; name: string; path: string; prompt: string; verify_text: string }>;
    };
    const plan = JSON.parse(await readFile(headhead('rote-plan.json'), 'utf8')) as {
      runs: Array<{ task: { id: string; name: string }; args: string[]; repetitions: number }>;
    };

    expect(plan.runs.map((run) => run.task.id)).toEqual(config.tasks.map((task) => task.id));
    for (const [index, task] of config.tasks.entries()) {
      const run = plan.runs[index];
      expect(run.task.name).toBe(task.name);
      expect(run.args).toContain(task.prompt);
      expect(run.args).toContain(`http://127.0.0.1:${config.fixture_port}/${task.path}`);
      expect(run.args[run.args.indexOf('--verify-text') + 1]).toBe(task.verify_text);
      expect(run.repetitions).toBe(config.repetitions);
    }
  });

  it('plans enough repetitions per task for the launch gate to certify a win', async () => {
    const config = JSON.parse(await readFile(headhead('tasks.json'), 'utf8')) as { repetitions: number };
    expect(config.repetitions).toBeGreaterThanOrEqual(15);
  });

  // Regression: the plan originally omitted --model, so every Rote run silently
  // used the SDK's default model while the records still declared the model from
  // sources.json — a record asserting a run it did not make. The competitor
  // runner takes --model explicitly, so only the Rote side could drift.
  it('pins the model on every Rote run so it cannot fall back to the SDK default', async () => {
    const config = JSON.parse(await readFile(headhead('tasks.json'), 'utf8')) as { model: string };
    const plan = JSON.parse(await readFile(headhead('rote-plan.json'), 'utf8')) as {
      runs: Array<{ args: string[] }>;
    };

    expect(config.model).toBeTruthy();
    for (const run of plan.runs) {
      expect(run.args[run.args.indexOf('--model') + 1]).toBe(config.model);
    }
  });
});
