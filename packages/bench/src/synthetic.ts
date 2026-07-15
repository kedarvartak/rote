import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildEnvFingerprint,
  computeResultDigest,
  writeTrajectoryJsonl,
  type RunManifest,
  type TokenUsage,
  type TrajectoryEvent,
} from '@rote/core';
import { runPaths } from '@rote/recorder';
import { buildBenchReport } from './accounting.js';
import { renderMarkdownReport } from './report.js';
import type { BenchmarkSpec, BenchmarkSpecRun } from './spec.js';
import type { BenchPhase, BenchTask } from './types.js';

export interface SyntheticBenchmarkOptions {
  outDir: string;
  tasks?: BenchTask[];
  phases?: BenchPhase[];
  repetitions?: number;
}

export interface SyntheticBenchmarkPack {
  specPath: string;
  reportPath: string;
  baseDir: string;
  usageDir: string;
  spec: BenchmarkSpec;
}

const DEFAULT_TASKS: BenchTask[] = [
  { id: 'B1', name: 'download latest report' },
  { id: 'B2', name: 'vendor registration' },
  { id: 'B3', name: 'catalog search extraction' },
];

const TOOL_BY_INDEX = ['browser.navigate', 'browser.click', 'browser.extract', 'browser.fill', 'browser.assert'] as const;

/**
 * Writes a deterministic fake M3 reproducibility pack: recorded run artifacts,
 * usage sidecars, benchmark spec, and Markdown report. This is not the real
 * browser benchmark; it proves the full reporting pipeline before live drivers
 * exist (docs/05-roadmap.md "Fake-world first").
 */
export async function writeSyntheticBenchmarkPack(options: SyntheticBenchmarkOptions): Promise<SyntheticBenchmarkPack> {
  const tasks = options.tasks ?? DEFAULT_TASKS;
  const phases = options.phases ?? ['cold', 'warm'];
  const repetitions = options.repetitions ?? 2;
  const baseDir = join(options.outDir, '.rote');
  const usageDir = join(options.outDir, 'usage');
  const runs: BenchmarkSpecRun[] = [];
  const cells = [];

  for (const task of tasks) {
    for (const phase of phases) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const runId = `${task.id.toLowerCase()}-${phase}-${repetition}`;
        const usageFile = `usage/${runId}.json`;
        const artifact = syntheticRun(task, phase, repetition, runId);
        await writeRunArtifact(baseDir, artifact.manifest, artifact.trajectory);
        await mkdir(usageDir, { recursive: true });
        await writeFile(join(options.outDir, usageFile), `${JSON.stringify(artifact.usage, null, 2)}\n`, 'utf8');
        runs.push({ task, phase, repetition, run_id: runId, usage_file: usageFile });
        cells.push({
          status: 'success' as const,
          task,
          phase,
          repetition,
          runId,
          manifest: { ...artifact.manifest, token_usage: artifact.usage },
          trajectory: artifact.trajectory,
        });
      }
    }
  }

  const spec: BenchmarkSpec = { base_dir: '.rote', runs };
  const specPath = join(options.outDir, 'bench-spec.json');
  const reportPath = join(options.outDir, 'report.md');
  await mkdir(options.outDir, { recursive: true });
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  await writeFile(reportPath, renderMarkdownReport(buildBenchReport(cells)), 'utf8');

  return { specPath, reportPath, baseDir, usageDir, spec };
}

function syntheticRun(task: BenchTask, phase: BenchPhase, repetition: number, runId: string): { manifest: RunManifest; trajectory: TrajectoryEvent[]; usage: TokenUsage[] } {
  const toolCalls = phase === 'cold' ? 40 : phase === 'warm' ? 6 : 8;
  const tokenTotal = phase === 'cold' ? 200_000 : phase === 'warm' ? 18_000 : 31_000;
  const started = Date.UTC(2026, 0, 1, 0, 0, repetition);
  const duration = phase === 'cold' ? 90_000 : phase === 'warm' ? 8_000 : 15_000;
  const usage = usageForPhase(phase, tokenTotal);
  return {
    manifest: {
      run_id: runId,
      task_spec: `${task.id}: ${task.name}`,
      env_fingerprint: buildEnvFingerprint({
        tool_inventory: TOOL_BY_INDEX.map((name) => ({ name, schema_hash: `schema-${name}` })),
        target_identity: 'synthetic-benchmark.local',
        surface_versions: { synthetic: '1' },
      }),
      outcome: 'success',
      started_at: new Date(started).toISOString(),
      ended_at: new Date(started + duration).toISOString(),
      token_usage: [],
    },
    trajectory: Array.from({ length: toolCalls }, (_, seq) => syntheticEvent(runId, seq, task, phase, started)),
    usage,
  };
}

function syntheticEvent(runId: string, seq: number, task: BenchTask, phase: BenchPhase, started: number): TrajectoryEvent {
  const result = { ok: true, task: task.id, phase, step: seq };
  return {
    run_id: runId,
    seq,
    ts: new Date(started + seq * 100).toISOString(),
    tool: TOOL_BY_INDEX[seq % TOOL_BY_INDEX.length] ?? 'browser.click',
    args: { synthetic_task: task.id, phase, step: seq },
    result_digest: computeResultDigest(result),
    result_ref: { kind: 'inline', value: result },
    duration_ms: 25,
  };
}

function usageForPhase(phase: BenchPhase, total: number): TokenUsage[] {
  if (phase === 'cold') return [{ source: 'planner', input_tokens: Math.floor(total * 0.8), output_tokens: Math.ceil(total * 0.2) }];
  if (phase === 'warm') {
    return [
      { source: 'matcher', input_tokens: 12_000, output_tokens: 1_000 },
      { source: 'slot', input_tokens: 4_000, output_tokens: 1_000 },
    ];
  }
  return [
    { source: 'matcher', input_tokens: 12_000, output_tokens: 1_000 },
    { source: 'repair', input_tokens: 15_000, output_tokens: 2_000 },
    { source: 'verify', input_tokens: 900, output_tokens: 100 },
  ];
}

async function writeRunArtifact(baseDir: string, manifest: RunManifest, trajectory: TrajectoryEvent[]): Promise<void> {
  const paths = runPaths(baseDir, manifest.run_id);
  await mkdir(paths.runDir, { recursive: true });
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(paths.trajectoryPath, writeTrajectoryJsonl(trajectory), 'utf8');
}
