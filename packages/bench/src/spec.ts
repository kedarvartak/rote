import type { BenchCell, BenchPhase, BenchTask } from './types.js';
import { readRecordedRun } from './run-store.js';

export interface BenchmarkSpecRun {
  task: BenchTask;
  phase: BenchPhase;
  repetition: number;
  run_id?: string;
  error?: string;
}

export interface BenchmarkSpec {
  base_dir: string;
  runs: BenchmarkSpecRun[];
}

/** Parses the JSON spec used by `rote-bench report`; intentionally small and explicit for human-editable benchmark manifests. */
export function parseBenchmarkSpec(raw: unknown): BenchmarkSpec {
  if (!isRecord(raw)) throw new Error('benchmark spec must be an object');
  const base_dir = typeof raw['base_dir'] === 'string' ? raw['base_dir'] : '.rote';
  const rawRuns = raw['runs'];
  if (!Array.isArray(rawRuns) || rawRuns.length === 0) throw new Error('benchmark spec requires a nonempty runs[] array');

  return {
    base_dir,
    runs: rawRuns.map((run, index) => parseSpecRun(run, index)),
  };
}

/** Loads spec cells from the standard run store, preserving declared failures as failed cells. */
export async function cellsFromSpec(spec: BenchmarkSpec): Promise<BenchCell[]> {
  const cells: BenchCell[] = [];
  for (const run of spec.runs) {
    const input = { task: run.task, phase: run.phase, repetition: run.repetition };
    if (run.error) {
      cells.push({ status: 'failure', ...input, error: run.error });
      continue;
    }
    if (!run.run_id) throw new Error(`run ${run.task.id}/${run.phase}/${run.repetition} requires run_id or error`);
    const recorded = await readRecordedRun(spec.base_dir, run.run_id);
    cells.push({ status: 'success', ...input, runId: run.run_id, ...recorded });
  }
  return cells;
}

function parseSpecRun(raw: unknown, index: number): BenchmarkSpecRun {
  if (!isRecord(raw)) throw new Error(`runs[${index}] must be an object`);
  const task = parseTask(raw['task'], index);
  const phase = parsePhase(raw['phase'], index);
  const repetition = raw['repetition'];
  if (typeof repetition !== 'number' || !Number.isInteger(repetition) || repetition < 1) throw new Error(`runs[${index}].repetition must be a positive integer`);
  const run_id = raw['run_id'];
  const error = raw['error'];
  if (run_id !== undefined && typeof run_id !== 'string') throw new Error(`runs[${index}].run_id must be a string`);
  if (error !== undefined && typeof error !== 'string') throw new Error(`runs[${index}].error must be a string`);
  if ((run_id && error) || (!run_id && !error)) throw new Error(`runs[${index}] must set exactly one of run_id or error`);
  return { task, phase, repetition, run_id, error };
}

function parseTask(raw: unknown, index: number): BenchTask {
  if (!isRecord(raw)) throw new Error(`runs[${index}].task must be an object`);
  const id = raw['id'];
  const name = raw['name'];
  if (typeof id !== 'string' || id.length === 0) throw new Error(`runs[${index}].task.id must be a nonempty string`);
  if (typeof name !== 'string' || name.length === 0) throw new Error(`runs[${index}].task.name must be a nonempty string`);
  const params = raw['params'];
  if (params !== undefined && !isRecord(params)) throw new Error(`runs[${index}].task.params must be an object`);
  return params === undefined ? { id, name } : { id, name, params };
}

function parsePhase(raw: unknown, index: number): BenchPhase {
  if (raw === 'cold' || raw === 'warm' || raw === 'drift') return raw;
  throw new Error(`runs[${index}].phase must be cold, warm, or drift`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
