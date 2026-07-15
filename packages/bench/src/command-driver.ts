import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readRecordedRun } from './run-store.js';
import type { BenchmarkSpec, BenchmarkSpecRun } from './spec.js';
import type { BenchPhase, BenchTask } from './types.js';

export interface CommandBenchmarkRun {
  task: BenchTask;
  phase: BenchPhase;
  repetition: number;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  run_id?: string;
  usage_file?: string;
}

export interface CommandBenchmarkPlan {
  base_dir?: string;
  runs: CommandBenchmarkRun[];
}

export interface CommandBenchmarkOptions {
  planPath: string;
  outDir: string;
  /** Injected for tests; production uses process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface CommandBenchmarkResult {
  specPath: string;
  spec: BenchmarkSpec;
}

/**
 * Parses the command-runner plan used to drive real/frozen benchmark cells.
 *
 * An entry may fan out with `repetitions: N` instead of a single `repetition`:
 * the head-to-head launch gate needs ≥15 successful runs per harness (see #40 /
 * docs/05 W5), and hand-authoring one entry per repetition is error-prone. A
 * fan-out entry expands to N concrete runs with `repetition` 1..N and auto-derived
 * per-run ids, so everything downstream (`runCommandBenchmarkPlan`) is unchanged.
 */
export function parseCommandBenchmarkPlan(raw: unknown): CommandBenchmarkPlan {
  if (!isRecord(raw)) throw new Error('command benchmark plan must be an object');
  const base_dir = raw['base_dir'];
  if (base_dir !== undefined && typeof base_dir !== 'string') throw new Error('base_dir must be a string');
  const rawRuns = raw['runs'];
  if (!Array.isArray(rawRuns) || rawRuns.length === 0) throw new Error('command benchmark plan requires a nonempty runs[] array');
  return { base_dir, runs: rawRuns.flatMap((run, index) => parsePlanRuns(run, index)) };
}

/**
 * Runs a command benchmark plan and writes `bench-spec.json` for `rote-bench report`.
 * Commands are expected to invoke the Recorder/Executor and write standard
 * `.rote/runs/<run_id>` artifacts; successful commands whose artifacts cannot
 * be loaded are marked as failed cells instead of being trusted.
 */
export async function runCommandBenchmarkPlan(options: CommandBenchmarkOptions): Promise<CommandBenchmarkResult> {
  const planPath = resolve(options.planPath);
  const plan = parseCommandBenchmarkPlan(JSON.parse(await readFile(planPath, 'utf8')));
  const outDir = resolve(options.outDir);
  const baseDir = resolve(dirname(planPath), plan.base_dir ?? join(outDir, '.rote'));
  const runs: BenchmarkSpecRun[] = [];

  await mkdir(outDir, { recursive: true });

  for (const run of plan.runs) {
    const runId = run.run_id ?? defaultRunId(run);
    const usageFile = run.usage_file ?? `usage/${runId}.json`;
    const usagePath = resolve(outDir, usageFile);
    await mkdir(dirname(usagePath), { recursive: true });

    const result = await runCommand(run, {
      ...options.env,
      ...run.env,
      ROTE_RUN_ID: runId,
      ROTE_BASE_DIR: baseDir,
      ROTE_TASK_SPEC: `${run.task.id}: ${run.task.name}`,
      ROTE_BENCH_TASK: run.task.id,
      ROTE_BENCH_PHASE: run.phase,
      ROTE_BENCH_REPETITION: String(run.repetition),
      ROTE_USAGE_FILE: usagePath,
    });

    if (result.ok) {
      try {
        await readRecordedRun(baseDir, runId);
        runs.push({ task: run.task, phase: run.phase, repetition: run.repetition, run_id: runId, usage_file: usageFile });
      } catch (error) {
        runs.push({ task: run.task, phase: run.phase, repetition: run.repetition, error: `missing run artifacts for ${runId}: ${message(error)}` });
      }
    } else {
      runs.push({ task: run.task, phase: run.phase, repetition: run.repetition, error: result.error });
    }
  }

  const spec: BenchmarkSpec = { base_dir: baseDir, runs };
  const specPath = join(outDir, 'bench-spec.json');
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  return { specPath, spec };
}

interface CommandResult {
  ok: boolean;
  error: string;
}

function runCommand(run: CommandBenchmarkRun, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolveCommand) => {
    const child = spawn(run.command, run.args ?? [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.resume();
    child.on('error', (error) => {
      resolveCommand({ ok: false, error: error.message });
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveCommand({ ok: true, error: '' });
      } else {
        resolveCommand({ ok: false, error: `command exited ${signal ? `with signal ${signal}` : `with code ${String(code)}`}${stderr ? `: ${stderr.trim()}` : ''}` });
      }
    });
  });
}

function parsePlanRuns(raw: unknown, index: number): CommandBenchmarkRun[] {
  if (!isRecord(raw)) throw new Error(`runs[${index}] must be an object`);
  const task = parseTask(raw['task'], index);
  const phase = parsePhase(raw['phase'], index);
  const command = raw['command'];
  if (typeof command !== 'string' || command.length === 0) throw new Error(`runs[${index}].command must be a nonempty string`);
  const args = raw['args'];
  const env = raw['env'];
  const run_id = raw['run_id'];
  const usage_file = raw['usage_file'];
  if (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))) throw new Error(`runs[${index}].args must be a string array`);
  if (env !== undefined && (!isRecord(env) || Object.values(env).some((value) => typeof value !== 'string'))) throw new Error(`runs[${index}].env must be a string map`);
  if (run_id !== undefined && typeof run_id !== 'string') throw new Error(`runs[${index}].run_id must be a string`);
  if (usage_file !== undefined && typeof usage_file !== 'string') throw new Error(`runs[${index}].usage_file must be a string`);
  const base = { task, phase, command, args, env: env as Record<string, string> | undefined };

  const repetition = raw['repetition'];
  const repetitions = raw['repetitions'];
  if (repetition !== undefined && repetitions !== undefined) throw new Error(`runs[${index}] must set only one of repetition or repetitions`);

  if (repetitions !== undefined) {
    if (typeof repetitions !== 'number' || !Number.isInteger(repetitions) || repetitions < 1) throw new Error(`runs[${index}].repetitions must be a positive integer`);
    // Per-run ids must be unique across the fan-out, so they are auto-derived
    // (`<task>-<phase>-<rep>`); an explicit id would collide across repetitions.
    if (run_id !== undefined) throw new Error(`runs[${index}].run_id is not allowed with repetitions (ids are auto-derived per repetition)`);
    if (usage_file !== undefined) throw new Error(`runs[${index}].usage_file is not allowed with repetitions (derived per repetition)`);
    return Array.from({ length: repetitions }, (_, i) => ({ ...base, repetition: i + 1 }));
  }

  if (typeof repetition !== 'number' || !Number.isInteger(repetition) || repetition < 1) throw new Error(`runs[${index}].repetition must be a positive integer`);
  return [{ ...base, repetition, run_id, usage_file }];
}

function parseTask(raw: unknown, index: number): BenchTask {
  if (!isRecord(raw)) throw new Error(`runs[${index}].task must be an object`);
  const id = raw['id'];
  const name = raw['name'];
  if (typeof id !== 'string' || id.length === 0) throw new Error(`runs[${index}].task.id must be a nonempty string`);
  if (typeof name !== 'string' || name.length === 0) throw new Error(`runs[${index}].task.name must be a nonempty string`);
  return { id, name };
}

function parsePhase(raw: unknown, index: number): BenchPhase {
  if (raw === 'cold' || raw === 'warm' || raw === 'drift') return raw;
  throw new Error(`runs[${index}].phase must be cold, warm, or drift`);
}

function defaultRunId(run: CommandBenchmarkRun): string {
  return `${run.task.id.toLowerCase()}-${run.phase}-${run.repetition}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
