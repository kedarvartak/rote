import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { parseTrajectoryJsonl, RunManifestSchema, TokenUsageSchema, totalInputTokens, type RunManifest, type TokenUsage } from '@rote/core';
import { runPaths } from '@rote/recorder';

// see docs/02 "Run economics" and invariant 5 (CLAUDE.md) — every model call is
// tagged, so a recorded run decomposes exactly by source. `rote report` is the
// read side of that invariant: the per-run instrument the billed exit-gate
// campaign reads (routing parity, shadow-predictor calibration, settle priors)
// without any provider call of its own.

/** What one step's recorded result contributes to the report; everything optional — the report never invents data. */
const ReportStepResultSchema = z.object({
  planner_usage: z.union([TokenUsageSchema, z.array(TokenUsageSchema)]).optional(),
  escalation_usage: z.array(TokenUsageSchema).optional(),
  route: z.object({ planner: z.enum(['routine', 'frontier']), reason: z.string(), escalated: z.boolean().optional() }).passthrough().optional(),
  prediction: z.object({ confidence: z.number(), source: z.string(), hit: z.boolean() }).passthrough().optional(),
  settle_ms: z.number().nonnegative().optional(),
}).passthrough();

export interface SourceUsageRow {
  source: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** uncached input + cache reads + cache writes — caching cannot masquerade as reduction (docs/03 "Metrics"). */
  logical_input_tokens: number;
}

export interface RunReport {
  runId: string;
  outcome?: RunManifest['outcome'];
  taskSpec?: string;
  steps: number;
  dispatchedSteps: number;
  usage: SourceUsageRow[];
  routing?: { routine: number; frontier: number; escalated: number };
  prediction?: { shadowed: number; hits: number; hitRate: number; meanConfidence: number };
  settle: Array<{ action_kind: string; samples: number; p50_ms: number; p90_ms: number; max_ms: number }>;
}

/**
 * Aggregates one recorded run into per-source token accounting plus routing,
 * shadow-prediction, and settle summaries. Pure read: works on any outcome,
 * including a run with no manifest yet (outcome stays undefined rather than
 * being guessed). Usage prefers the manifest's authoritative `token_usage`;
 * a manifest-less run falls back to the per-step recorded usage.
 */
export async function reportRun(baseDir: string, runId: string): Promise<RunReport> {
  const paths = runPaths(baseDir, runId);
  let manifest: RunManifest | undefined;
  try {
    manifest = RunManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, 'utf8')));
  } catch {
    manifest = undefined;
  }
  const events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));

  const stepUsage: TokenUsage[] = [];
  const settleSamples = new Map<string, number[]>();
  let routing: RunReport['routing'];
  let shadowed = 0, hits = 0, confidenceSum = 0;
  let dispatchedSteps = 0;

  for (const event of events) {
    const ref = event.result_ref;
    let raw: unknown;
    if (ref.kind === 'inline') raw = ref.value;
    else {
      const blobPath = isAbsolute(ref.path) ? ref.path : join(paths.runDir, ref.path);
      try { raw = JSON.parse(await readFile(blobPath, 'utf8')); } catch { raw = undefined; }
    }
    const parsed = ReportStepResultSchema.safeParse(raw ?? {});
    if (!parsed.success) continue;
    const step = parsed.data;
    if (event.tool.startsWith('browser.') && event.tool !== 'browser.done' && !event.error) dispatchedSteps += 1;
    for (const usage of [step.planner_usage ?? [], step.escalation_usage ?? []].flat()) stepUsage.push(usage);
    if (step.route) {
      routing ??= { routine: 0, frontier: 0, escalated: 0 };
      routing[step.route.planner] += 1;
      if (step.route.escalated) routing.escalated += 1;
    }
    if (step.prediction) {
      shadowed += 1;
      if (step.prediction.hit) hits += 1;
      confidenceSum += step.prediction.confidence;
    }
    if (typeof step.settle_ms === 'number') {
      const kind = event.tool.replace(/^browser\./, '');
      settleSamples.set(kind, [...(settleSamples.get(kind) ?? []), step.settle_ms]);
    }
  }

  const usageRows = new Map<string, SourceUsageRow>();
  for (const usage of manifest?.token_usage.length ? manifest.token_usage : stepUsage) {
    const row = usageRows.get(usage.source) ?? {
      source: usage.source, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, logical_input_tokens: 0,
    };
    row.calls += 1;
    row.input_tokens += usage.input_tokens;
    row.output_tokens += usage.output_tokens;
    row.cache_read_tokens += usage.cache_read_tokens;
    row.cache_write_tokens += usage.cache_write_tokens;
    row.logical_input_tokens += totalInputTokens(usage);
    usageRows.set(usage.source, row);
  }

  const rank = (sorted: number[], q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
  const settle = [...settleSamples.entries()].map(([action_kind, samples]) => {
    const sorted = [...samples].sort((a, b) => a - b);
    return { action_kind, samples: sorted.length, p50_ms: rank(sorted, 0.5), p90_ms: rank(sorted, 0.9), max_ms: sorted[sorted.length - 1]! };
  }).sort((a, b) => a.action_kind.localeCompare(b.action_kind));

  return {
    runId,
    ...(manifest ? { outcome: manifest.outcome, taskSpec: manifest.task_spec } : {}),
    steps: events.length,
    dispatchedSteps,
    usage: [...usageRows.values()].sort((a, b) => a.source.localeCompare(b.source)),
    ...(routing ? { routing } : {}),
    ...(shadowed > 0 ? { prediction: { shadowed, hits, hitRate: hits / shadowed, meanConfidence: confidenceSum / shadowed } } : {}),
    settle,
  };
}

/** Renders a report for the terminal: one usage row per source, then routing/prediction/settle blocks. */
export function formatRunReport(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`run ${report.runId}${report.outcome ? ` — ${report.outcome}` : ' — no manifest (in progress or killed)'}`);
  if (report.taskSpec) lines.push(`task: ${report.taskSpec}`);
  lines.push(`events: ${report.steps} (${report.dispatchedSteps} dispatched browser actions)`);
  if (report.usage.length === 0) {
    lines.push('tokens: none recorded');
  } else {
    lines.push('tokens by source (logical input = uncached + cache reads + cache writes):');
    for (const row of report.usage) {
      lines.push(`  ${row.source}: ${row.calls} calls, ${row.logical_input_tokens} logical input (${row.input_tokens} uncached, ${row.cache_read_tokens} cache read, ${row.cache_write_tokens} cache write), ${row.output_tokens} output`);
    }
  }
  if (report.routing) {
    lines.push(`routing: ${report.routing.routine} routine, ${report.routing.frontier} frontier, ${report.routing.escalated} escalated`);
  }
  if (report.prediction) {
    lines.push(`shadow predictor: ${report.prediction.hits}/${report.prediction.shadowed} hits (${(report.prediction.hitRate * 100).toFixed(1)}%), mean confidence ${report.prediction.meanConfidence.toFixed(2)}`);
  }
  for (const row of report.settle) {
    lines.push(`settle ${row.action_kind}: p50 ${row.p50_ms} ms, p90 ${row.p90_ms} ms, max ${row.max_ms} ms (${row.samples} samples)`);
  }
  return lines.join('\n');
}
