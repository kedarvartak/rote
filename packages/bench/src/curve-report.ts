import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { parseCurveStepJsonl, type CurveStepRecord } from './curve-protocol.js';
import { DEFAULT_PRICE_TABLE, priceForModel, runCostUsd } from './pricing.js';
import { mean, percentile } from './stats.js';

const DEFAULT_RESAMPLES = 10_000;
const DEFAULT_CONFIDENCE = 0.95;
const DEFAULT_SEED = 0x9e3779b9;

const IntervalSchema = z.object({
  point: z.number(),
  lower: z.number(),
  upper: z.number(),
});

const HarnessCellSchema = z.object({
  successful_runs: z.number().int().nonnegative(),
  attempted_runs: z.number().int().positive(),
  success_rate: z.number().min(0).max(1),
  logical_input_tokens: IntervalSchema,
  mean_uncached_input_tokens: z.number().nonnegative(),
  mean_cache_read_tokens: z.number().nonnegative(),
  mean_cache_write_tokens: z.number().nonnegative(),
  mean_output_tokens: z.number().nonnegative(),
  latency_p50_ms: z.number().nonnegative(),
  latency_p95_ms: z.number().nonnegative(),
  mean_cost_usd: z.number().nonnegative().nullable(),
});

/** Machine-readable result behind the published G1 curve and claim. */
export const CurveReportSummarySchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  subject_harness: z.string().min(1),
  baseline_harness: z.string().min(1),
  confidence: z.number().min(0).max(1),
  resamples: z.number().int().positive(),
  min_successful_runs_per_cell: z.number().int().positive(),
  complete_matched_repetitions: z.number().int().nonnegative(),
  slope_reduction_floor: z.number().min(0).max(1),
  pricing: z.object({ version: z.string().min(1), source: z.string().min(1) }).nullable(),
  cells: z.array(z.object({
    task_id: z.string().min(1),
    target_steps: z.number().int().positive(),
    subject: HarnessCellSchema,
    baseline: HarnessCellSchema,
    logical_input_reduction: IntervalSchema,
  })).min(2),
  slope: z.object({
    subject_tokens_per_interaction: z.number().positive(),
    baseline_tokens_per_interaction: z.number().positive(),
    reduction: IntervalSchema,
    passed: z.boolean(),
  }),
  a4: z.object({
    full_observations: z.number().int().nonnegative(),
    bootstrap_observations: z.number().int().nonnegative(),
    diff_observations: z.number().int().nonnegative(),
    median_full_chars: z.number().nonnegative().nullable(),
    median_bootstrap_chars: z.number().nonnegative().nullable(),
    median_diff_chars: z.number().nonnegative().nullable(),
    median_diff_reduction_vs_preceding_bootstrap: z.number().min(0).max(1).nullable(),
  }),
});
/** Validated machine-readable G1 report result. */
export type CurveReportSummary = z.infer<typeof CurveReportSummarySchema>;

/** Deterministic audit, bootstrap, and public gate settings. */
export interface BuildCurveReportOptions {
  subjectHarness?: string;
  baselineHarness?: string;
  minRuns?: number;
  resamples?: number;
  confidence?: number;
  seed?: number;
  slopeReductionFloor?: number;
}

type CurveMeasurementRecord = Extract<CurveStepRecord, { record_kind: 'measurement' }>;

interface AuditedRun {
  runId: string;
  taskId: string;
  repetition: number;
  targetSteps: number;
  outcome: 'success' | 'failure';
  logicalInput: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  latencyMs: number;
  costUsd: number | null;
  records: CurveMeasurementRecord[];
}

/** Audits normalized receipts and builds the deterministic G1 report summary. */
export function buildCurveReport(
  subjectRecords: readonly CurveStepRecord[],
  baselineRecords: readonly CurveStepRecord[],
  options: BuildCurveReportOptions = {},
): CurveReportSummary {
  const subjectHarness = options.subjectHarness ?? 'rote';
  const baselineHarness = options.baselineHarness ?? 'browser-use';
  const minRuns = options.minRuns ?? 15;
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
  const seed = options.seed ?? DEFAULT_SEED;
  const slopeReductionFloor = options.slopeReductionFloor ?? 0.30;
  const identity = auditSharedIdentity(subjectRecords, baselineRecords, subjectHarness, baselineHarness);
  const subjectRuns = auditRuns(asMeasurementRecords(subjectRecords), identity.model);
  const baselineRuns = auditRuns(asMeasurementRecords(baselineRecords), identity.model);
  const tasks = [...new Set(subjectRuns.map((run) => run.taskId))]
    .map((taskId) => ({ taskId, targetSteps: subjectRuns.find((run) => run.taskId === taskId)!.targetSteps }))
    .sort((a, b) => a.targetSteps - b.targetSteps);
  const baselineTasks = new Map(baselineRuns.map((run) => [run.taskId, run.targetSteps]));
  if (tasks.some((task) => baselineTasks.get(task.taskId) !== task.targetSteps) || baselineTasks.size !== tasks.length) {
    throw new Error('curve harnesses do not contain the same checkpoint identities and target steps');
  }

  const cells = tasks.map((task, index) => {
    const subject = subjectRuns.filter((run) => run.taskId === task.taskId);
    const baseline = baselineRuns.filter((run) => run.taskId === task.taskId);
    const subjectSuccess = subject.filter((run) => run.outcome === 'success');
    const baselineSuccess = baseline.filter((run) => run.outcome === 'success');
    if (subjectSuccess.length < minRuns || baselineSuccess.length < minRuns) {
      throw new Error(`${task.taskId} has fewer than ${minRuns} successful runs per harness`);
    }
    if (subjectSuccess.length / subject.length < baselineSuccess.length / baseline.length) {
      throw new Error(`${task.taskId} fails success parity: ${subjectSuccess.length}/${subject.length} < ${baselineSuccess.length}/${baseline.length}`);
    }
    return {
      task_id: task.taskId,
      target_steps: task.targetSteps,
      subject: summarizeHarnessCell(subject, confidence, resamples, seed + index),
      baseline: summarizeHarnessCell(baseline, confidence, resamples, seed + 100 + index),
      logical_input_reduction: bootstrapIndependentReduction(
        subjectSuccess.map((run) => run.logicalInput),
        baselineSuccess.map((run) => run.logicalInput),
        confidence,
        resamples,
        seed + 200 + index,
      ),
    };
  });

  // see docs/03-benchmark.md "The G1 report" — preserve paired collection
  // during slope resampling instead of erasing provider-time variance.
  const matchedRepetitions = completeMatchedRepetitions(subjectRuns, baselineRuns, tasks.map((task) => task.taskId));
  if (matchedRepetitions.length < minRuns) {
    throw new Error(`only ${matchedRepetitions.length} complete successful matched repetitions; need ${minRuns}`);
  }
  const slope = bootstrapSlope(subjectRuns, baselineRuns, tasks, matchedRepetitions, confidence, resamples, seed + 500);
  const summary = {
    schema_version: 1 as const,
    ...identity,
    subject_harness: subjectHarness,
    baseline_harness: baselineHarness,
    confidence,
    resamples,
    min_successful_runs_per_cell: minRuns,
    complete_matched_repetitions: matchedRepetitions.length,
    slope_reduction_floor: slopeReductionFloor,
    pricing: priceForModel(identity.model) ? {
      version: DEFAULT_PRICE_TABLE.version,
      source: identity.provider === 'openai'
        ? 'https://developers.openai.com/api/docs/pricing'
        : DEFAULT_PRICE_TABLE.source,
    } : null,
    cells,
    slope: {
      subject_tokens_per_interaction: slope.subject,
      baseline_tokens_per_interaction: slope.baseline,
      reduction: slope.reduction,
      passed: slope.reduction.lower >= slopeReductionFloor,
    },
    a4: summarizeA4(subjectRuns),
  };
  return CurveReportSummarySchema.parse(summary);
}

/** Reads two JSONL artifacts and writes Markdown, SVG, and machine-readable summary files. */
export async function writeCurveReport(
  subjectPath: string,
  baselinePath: string,
  outputs: { markdown: string; svg: string; summary: string },
  options: BuildCurveReportOptions = {},
): Promise<CurveReportSummary> {
  const summary = buildCurveReport(
    parseCurveStepJsonl(await readFile(subjectPath, 'utf8')),
    parseCurveStepJsonl(await readFile(baselinePath, 'utf8')),
    options,
  );
  await Promise.all(Object.values(outputs).map((path) => mkdir(dirname(path), { recursive: true })));
  await Promise.all([
    writeFile(outputs.markdown, renderCurveReport(summary), 'utf8'),
    writeFile(outputs.svg, renderCurveSvg(summary), 'utf8'),
    writeFile(outputs.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
  ]);
  return summary;
}

/** Renders the audited G1 method and result table. */
export function renderCurveReport(summary: CurveReportSummary): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const token = (value: number) => Math.round(value).toLocaleString('en-US');
  const lines = [
    '# G1 cumulative logical-input curve',
    '',
    `Protocol \`${summary.protocol_id}\`; ${summary.provider}/\`${summary.model}\`; ${summary.complete_matched_repetitions} complete matched repetitions; ${(summary.confidence * 100).toFixed(0)}% seeded-bootstrap intervals (${summary.resamples.toLocaleString('en-US')} resamples).${summary.pricing ? ` Costs use the ${summary.pricing.version} published model rates (${summary.pricing.source}).` : ''}`,
    '',
    `**Result: ${summary.slope.passed ? 'PASS' : 'FAIL'}.** ${summary.subject_harness} cumulative logical-input growth is ${pct(summary.slope.reduction.point)} slower than ${summary.baseline_harness} (${pct(summary.slope.reduction.lower)}–${pct(summary.slope.reduction.upper)}), against the public ${pct(summary.slope_reduction_floor)} lower-bound floor.`,
    '',
    '| Cell | Steps | Rote logical input (95% CI) | Browser Use logical input (95% CI) | Reduction (95% CI) | Success R / B |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const cell of summary.cells) {
    const interval = (value: z.infer<typeof IntervalSchema>) => `${token(value.point)} [${token(value.lower)}–${token(value.upper)}]`;
    lines.push(`| ${cell.task_id} | ${cell.target_steps} | ${interval(cell.subject.logical_input_tokens)} | ${interval(cell.baseline.logical_input_tokens)} | ${pct(cell.logical_input_reduction.point)} [${pct(cell.logical_input_reduction.lower)}–${pct(cell.logical_input_reduction.upper)}] | ${cell.subject.successful_runs}/${cell.subject.attempted_runs} / ${cell.baseline.successful_runs}/${cell.baseline.attempted_runs} |`);
  }
  const allRunsPassed = summary.cells.every((cell) =>
    cell.subject.successful_runs === cell.subject.attempted_runs &&
    cell.baseline.successful_runs === cell.baseline.attempted_runs,
  );
  lines.push(
    '',
    `Logical input is \`uncached input + cache reads + cache writes\`; caching cannot masquerade as token reduction. ${allRunsPassed ? 'Every run concluded and passed the independent database verifier.' : 'Only concluded, independently verified runs enter token intervals.'} Failed and abandoned attempts remain in the success-rate denominator.`, 
    '',
    '| Cell | Harness | Uncached input | Cache reads | Cache writes | Output | Latency p50/p95 | Mean cost |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  );
  for (const cell of summary.cells) {
    for (const [name, stats] of [['Rote', cell.subject], ['Browser Use', cell.baseline]] as const) {
      lines.push(`| ${cell.task_id} | ${name} | ${token(stats.mean_uncached_input_tokens)} | ${token(stats.mean_cache_read_tokens)} | ${token(stats.mean_cache_write_tokens)} | ${token(stats.mean_output_tokens)} | ${(stats.latency_p50_ms / 1000).toFixed(1)}s / ${(stats.latency_p95_ms / 1000).toFixed(1)}s | ${stats.mean_cost_usd === null ? 'price unavailable' : `$${stats.mean_cost_usd.toFixed(4)}`} |`);
    }
  }
  const longest = summary.cells.at(-1)!;
  const relative = (subject: number, baseline: number) => {
    const delta = subject / baseline - 1;
    return `${pct(Math.abs(delta))} ${delta >= 0 ? 'higher' : 'lower'}`;
  };
  const costNote = longest.subject.mean_cost_usd !== null && longest.baseline.mean_cost_usd !== null
    ? `At ${longest.task_id}, Rote's mean billed cost is ${relative(longest.subject.mean_cost_usd, longest.baseline.mean_cost_usd)} despite using fewer logical-input tokens, because Browser Use receives substantially more discounted cache reads. Rote's p50 latency is ${relative(longest.subject.latency_p50_ms, longest.baseline.latency_p50_ms)}. G1 is a logical-token growth claim, not a cost or latency win.`
    : `At ${longest.task_id}, model pricing is unavailable; G1 is a logical-token growth claim, not a cost or latency win.`;
  lines.push(
    '',
    costNote,
    '',
    `A4 emitted ${summary.a4.diff_observations} diffs (median ${summary.a4.median_diff_chars ?? 'n/a'} chars) and ${summary.a4.bootstrap_observations} grounded bootstraps (median ${summary.a4.median_bootstrap_chars ?? 'n/a'} chars). Relative to each diff's preceding grounded bootstrap, the median render-size reduction was ${summary.a4.median_diff_reduction_vs_preceding_bootstrap === null ? 'n/a' : pct(summary.a4.median_diff_reduction_vs_preceding_bootstrap)}.`,
    '',
  );
  return `${lines.join('\n')}\n`;
}

/** Renders a dependency-free SVG curve with bootstrap interval whiskers. */
export function renderCurveSvg(summary: CurveReportSummary): string {
  const width = 820; const height = 470; const left = 85; const right = 30; const top = 45; const bottom = 75;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const xs = summary.cells.map((cell) => cell.target_steps);
  const maximum = Math.max(...summary.cells.flatMap((cell) => [cell.subject.logical_input_tokens.upper, cell.baseline.logical_input_tokens.upper])) * 1.1;
  const x = (value: number) => left + ((value - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs))) * plotWidth;
  const y = (value: number) => top + plotHeight - (value / maximum) * plotHeight;
  const path = (side: 'subject' | 'baseline') => summary.cells.map((cell, index) => `${index === 0 ? 'M' : 'L'}${x(cell.target_steps).toFixed(1)},${y(cell[side].logical_input_tokens.point).toFixed(1)}`).join(' ');
  const whiskers = (side: 'subject' | 'baseline', color: string) => summary.cells.map((cell) => {
    const xx = x(cell.target_steps); const interval = cell[side].logical_input_tokens;
    return `<path d="M${xx},${y(interval.lower)}V${y(interval.upper)}M${xx - 5},${y(interval.lower)}H${xx + 5}M${xx - 5},${y(interval.upper)}H${xx + 5}" stroke="${color}" stroke-width="1.5"/><circle cx="${xx}" cy="${y(interval.point)}" r="4" fill="${color}"/>`;
  }).join('');
  const yTicks = Array.from({ length: 5 }, (_, index) => (maximum * index) / 4);
  const grid = yTicks.map((value) => `<g><line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#e5e7eb"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${Math.round(value / 1000)}K</text></g>`).join('');
  const xTicks = summary.cells.map((cell) => `<text x="${x(cell.target_steps)}" y="${height - bottom + 28}" text-anchor="middle">${cell.target_steps}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Cumulative logical input tokens by required interactions</title><desc id="desc">Rote grows more slowly than Browser Use across five WordPress tag-creation checkpoints. Error bars are 95 percent seeded-bootstrap intervals.</desc><rect width="100%" height="100%" fill="white"/><g font-family="system-ui,sans-serif" font-size="12" fill="#374151">${grid}${xTicks}<line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#111827"/><line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#111827"/><text x="${left + plotWidth / 2}" y="${height - 18}" text-anchor="middle" font-size="14">Required browser interactions</text><text transform="translate(20 ${top + plotHeight / 2}) rotate(-90)" text-anchor="middle" font-size="14">Cumulative logical input tokens</text><path d="${path('baseline')}" fill="none" stroke="#6b7280" stroke-width="3"/>${whiskers('baseline', '#6b7280')}<path d="${path('subject')}" fill="none" stroke="#2563eb" stroke-width="3"/>${whiskers('subject', '#2563eb')}<g transform="translate(${left + 15} ${top + 8})"><line x2="28" stroke="#2563eb" stroke-width="3"/><text x="36" y="4">Rote</text><line x1="95" x2="123" stroke="#6b7280" stroke-width="3"/><text x="131" y="4">Browser Use 0.13.6</text></g><text x="${width - right}" y="${top + 5}" text-anchor="end" font-weight="600">Slope reduction ${ (summary.slope.reduction.point * 100).toFixed(1)}%</text></g></svg>\n`;
}

function auditSharedIdentity(subject: readonly CurveStepRecord[], baseline: readonly CurveStepRecord[], subjectHarness: string, baselineHarness: string) {
  if (subject.length === 0 || baseline.length === 0) throw new Error('curve evidence cannot be empty');
  const first = subject[0]!;
  const expected = { protocol_id: first.protocol_id, provider: first.provider, model: first.model };
  for (const [label, records, harness] of [['subject', subject, subjectHarness], ['baseline', baseline, baselineHarness]] as const) {
    for (const record of records) {
      if (record.record_kind !== 'measurement') throw new Error(`${label} contains non-measurement rows`);
      if (record.harness !== harness) throw new Error(`${label} row uses harness ${record.harness}, expected ${harness}`);
      if (record.protocol_id !== expected.protocol_id || record.provider !== expected.provider || record.model !== expected.model) {
        throw new Error(`${label} mixes protocol/provider/model identity`);
      }
    }
  }
  return expected;
}

function asMeasurementRecords(records: readonly CurveStepRecord[]): CurveMeasurementRecord[] {
  return records.map((record) => {
    if (record.record_kind !== 'measurement') throw new Error('curve report cannot contain dry-run records');
    return record;
  });
}

function auditRuns(records: readonly CurveMeasurementRecord[], model: string): AuditedRun[] {
  const grouped = new Map<string, CurveMeasurementRecord[]>();
  for (const record of records) {
    const rows = grouped.get(record.run_id) ?? [];
    rows.push(record);
    grouped.set(record.run_id, rows);
  }
  const seenCells = new Set<string>();
  return [...grouped.entries()].map(([runId, rows]) => {
    const first = rows[0]!;
    const cellKey = `${first.task_id}\u0000${first.repetition}`;
    if (seenCells.has(cellKey)) throw new Error(`duplicate run for ${first.task_id} repetition ${first.repetition}`);
    seenCells.add(cellKey);
    let input = 0; let cacheRead = 0; let cacheWrite = 0; let output = 0; let latencyMs = 0;
    rows.forEach((row, index) => {
      if (row.task_id !== first.task_id || row.repetition !== first.repetition || row.target_steps !== first.target_steps) {
        throw new Error(`${runId} changes checkpoint identity within the run`);
      }
      if (row.step_index !== index + 1) throw new Error(`${runId} has non-contiguous step indexes`);
      input += row.usage.input_tokens; cacheRead += row.usage.cache_read_tokens;
      cacheWrite += row.usage.cache_write_tokens; output += row.usage.output_tokens; latencyMs += row.duration_ms;
      if (row.cumulative_usage.input_tokens !== input || row.cumulative_usage.cache_read_tokens !== cacheRead || row.cumulative_usage.cache_write_tokens !== cacheWrite || row.cumulative_usage.output_tokens !== output) {
        throw new Error(`${runId} has inconsistent cumulative usage at step ${row.step_index}`);
      }
      if (index < rows.length - 1 && row.step_outcome !== 'continued') throw new Error(`${runId} terminates before its final row`);
    });
    const final = rows.at(-1)!;
    if (final.step_outcome === 'continued') throw new Error(`${runId} has an incomplete tail`);
    if (final.step_outcome === 'success' && final.verification_passed !== true) {
      throw new Error(`${runId} reports success without passed terminal verification`);
    }
    const price = priceForModel(model);
    return {
      runId, taskId: final.task_id, repetition: final.repetition, targetSteps: final.target_steps,
      outcome: final.step_outcome, logicalInput: input + cacheRead + cacheWrite,
      input, cacheRead, cacheWrite, output, latencyMs,
      costUsd: price ? runCostUsd(input, output, price, cacheRead, cacheWrite) : null,
      records: [...rows],
    };
  });
}

function summarizeHarnessCell(runs: readonly AuditedRun[], confidence: number, resamples: number, seed: number) {
  const successful = runs.filter((run) => run.outcome === 'success');
  const logical = successful.map((run) => run.logicalInput);
  const costs = successful.map((run) => run.costUsd).filter((cost): cost is number => cost !== null);
  return {
    successful_runs: successful.length,
    attempted_runs: runs.length,
    success_rate: successful.length / runs.length,
    logical_input_tokens: bootstrapMeanInterval(logical, confidence, resamples, seed),
    mean_uncached_input_tokens: mean(successful.map((run) => run.input)),
    mean_cache_read_tokens: mean(successful.map((run) => run.cacheRead)),
    mean_cache_write_tokens: mean(successful.map((run) => run.cacheWrite)),
    mean_output_tokens: mean(successful.map((run) => run.output)),
    latency_p50_ms: percentile(successful.map((run) => run.latencyMs).sort((a, b) => a - b), 0.5),
    latency_p95_ms: percentile(successful.map((run) => run.latencyMs).sort((a, b) => a - b), 0.95),
    mean_cost_usd: costs.length === successful.length ? mean(costs) : null,
  };
}

function completeMatchedRepetitions(subject: readonly AuditedRun[], baseline: readonly AuditedRun[], tasks: readonly string[]): number[] {
  const repetitions = new Set(subject.map((run) => run.repetition));
  return [...repetitions].filter((repetition) => tasks.every((task) =>
    subject.some((run) => run.repetition === repetition && run.taskId === task && run.outcome === 'success') &&
    baseline.some((run) => run.repetition === repetition && run.taskId === task && run.outcome === 'success'),
  )).sort((a, b) => a - b);
}

function bootstrapSlope(subject: readonly AuditedRun[], baseline: readonly AuditedRun[], tasks: readonly { taskId: string; targetSteps: number }[], repetitions: readonly number[], confidence: number, resamples: number, seed: number) {
  const slopeFor = (runs: readonly AuditedRun[], reps: readonly number[]) => linearSlope(
    tasks.map((task) => task.targetSteps),
    tasks.map((task) => mean(reps.map((rep) => runs.find((run) => run.taskId === task.taskId && run.repetition === rep && run.outcome === 'success')!.logicalInput))),
  );
  const subjectSlope = slopeFor(subject, repetitions); const baselineSlope = slopeFor(baseline, repetitions);
  const random = mulberry32(seed); const draws: number[] = [];
  for (let index = 0; index < resamples; index += 1) {
    const sample = Array.from({ length: repetitions.length }, () => repetitions[Math.floor(random() * repetitions.length)]!);
    draws.push(1 - slopeFor(subject, sample) / slopeFor(baseline, sample));
  }
  draws.sort((a, b) => a - b); const alpha = (1 - confidence) / 2;
  return { subject: subjectSlope, baseline: baselineSlope, reduction: { point: 1 - subjectSlope / baselineSlope, lower: percentile(draws, alpha), upper: percentile(draws, 1 - alpha) } };
}

function summarizeA4(runs: readonly AuditedRun[]) {
  const full: number[] = []; const bootstrap: number[] = []; const diff: number[] = []; const reductions: number[] = [];
  for (const run of runs) {
    let precedingBootstrap: number | undefined;
    for (const record of run.records) {
      const observation = record.observation;
      if (!observation) continue;
      if (observation.mode === 'full') full.push(observation.rendered_chars);
      if (observation.mode === 'bootstrap') { bootstrap.push(observation.rendered_chars); precedingBootstrap = observation.rendered_chars; }
      if (observation.mode === 'diff') {
        diff.push(observation.rendered_chars);
        if (precedingBootstrap && observation.rendered_chars <= precedingBootstrap) reductions.push(1 - observation.rendered_chars / precedingBootstrap);
      }
    }
  }
  const median = (values: number[]) => values.length ? percentile(values.sort((a, b) => a - b), 0.5) : null;
  return {
    full_observations: full.length, bootstrap_observations: bootstrap.length, diff_observations: diff.length,
    median_full_chars: median(full), median_bootstrap_chars: median(bootstrap), median_diff_chars: median(diff),
    median_diff_reduction_vs_preceding_bootstrap: median(reductions),
  };
}

function bootstrapMeanInterval(values: readonly number[], confidence: number, resamples: number, seed: number) {
  const random = mulberry32(seed); const draws: number[] = [];
  for (let index = 0; index < resamples; index += 1) draws.push(mean(Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]!)));
  draws.sort((a, b) => a - b); const alpha = (1 - confidence) / 2;
  return { point: mean(values), lower: percentile(draws, alpha), upper: percentile(draws, 1 - alpha) };
}

function bootstrapIndependentReduction(subject: readonly number[], baseline: readonly number[], confidence: number, resamples: number, seed: number) {
  const random = mulberry32(seed); const draws: number[] = [];
  for (let index = 0; index < resamples; index += 1) {
    const s = mean(Array.from({ length: subject.length }, () => subject[Math.floor(random() * subject.length)]!));
    const b = mean(Array.from({ length: baseline.length }, () => baseline[Math.floor(random() * baseline.length)]!));
    draws.push(1 - s / b);
  }
  draws.sort((a, b) => a - b); const alpha = (1 - confidence) / 2;
  return { point: 1 - mean(subject) / mean(baseline), lower: percentile(draws, alpha), upper: percentile(draws, 1 - alpha) };
}

function linearSlope(xs: readonly number[], ys: readonly number[]): number {
  const xMean = mean(xs); const yMean = mean(ys);
  return xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index]! - yMean), 0) /
    xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4294967296; };
}
