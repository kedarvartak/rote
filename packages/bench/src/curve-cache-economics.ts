import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { bootstrapReductionInterval } from './competitor-gate.js';
import { buildCurveReport } from './curve-report.js';
import { parseCurveStepJsonl, type CurveStepRecord } from './curve-protocol.js';
import { DEFAULT_PRICE_TABLE, priceForModel, runCostUsd } from './pricing.js';
import { mean } from './stats.js';

const EconomicIntervalSchema = z.object({
  point: z.number(), lower: z.number(), upper: z.number(), confidence: z.number(), resamples: z.number().int().positive(),
});

/** Validated before/after provider-cache economics report. */
export const CurveCacheEconomicsSchema = z.object({
  schema_version: z.literal(1),
  before_protocol_id: z.string().min(1),
  after_protocol_id: z.string().min(1),
  baseline_protocol_id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  successful_runs_per_harness: z.number().int().min(15),
  pricing: z.object({ version: z.string().min(1), source: z.string().min(1) }),
  cells: z.array(z.object({
    task_id: z.string().min(1),
    target_steps: z.number().int().positive(),
    before: z.object({ mean_cost_usd: z.number().nonnegative(), mean_logical_input: z.number().nonnegative(), mean_cache_read: z.number().nonnegative(), cache_hit_rate: z.number().min(0).max(1) }),
    after: z.object({ mean_cost_usd: z.number().nonnegative(), mean_logical_input: z.number().nonnegative(), mean_cache_read: z.number().nonnegative(), cache_hit_rate: z.number().min(0).max(1) }),
    baseline: z.object({ mean_cost_usd: z.number().nonnegative(), mean_logical_input: z.number().nonnegative(), mean_cache_read: z.number().nonnegative(), cache_hit_rate: z.number().min(0).max(1) }),
    after_vs_before_cost_reduction: EconomicIntervalSchema,
    after_vs_baseline_cost_reduction: EconomicIntervalSchema,
  })).min(2),
});
/** Machine-readable cache economics result. */
export type CurveCacheEconomics = z.infer<typeof CurveCacheEconomicsSchema>;

export interface BuildCurveCacheEconomicsOptions {
  subjectProtocolSuffix: string;
  minRuns?: number;
}

interface EconomicRun {
  taskId: string;
  targetSteps: number;
  cost: number;
  logicalInput: number;
  cacheRead: number;
  cacheHitCalls: number;
  calls: number;
}

/** Audits frozen and optimized matrices before comparing cache hit and billed-cost economics. */
export function buildCurveCacheEconomics(
  beforeRecords: readonly CurveStepRecord[],
  afterRecords: readonly CurveStepRecord[],
  baselineRecords: readonly CurveStepRecord[],
  options: BuildCurveCacheEconomicsOptions,
): CurveCacheEconomics {
  const minRuns = options.minRuns ?? 15;
  const beforeAudit = buildCurveReport(beforeRecords, baselineRecords, { minRuns });
  const afterAudit = buildCurveReport(afterRecords, baselineRecords, {
    minRuns,
    subjectProtocolSuffix: options.subjectProtocolSuffix,
  });
  if (beforeAudit.model !== afterAudit.model || beforeAudit.provider !== afterAudit.provider) {
    throw new Error('cache economics matrices use different provider/model identity');
  }
  const beforeRuns = economicRuns(beforeRecords, beforeAudit.model);
  const afterRuns = economicRuns(afterRecords, afterAudit.model);
  const baselineRuns = economicRuns(baselineRecords, afterAudit.model);
  const cells = afterAudit.cells.map((cell) => {
    const before = beforeRuns.filter((run) => run.taskId === cell.task_id);
    const after = afterRuns.filter((run) => run.taskId === cell.task_id);
    const baseline = baselineRuns.filter((run) => run.taskId === cell.task_id);
    if (before.length < minRuns || after.length < minRuns || baseline.length < minRuns) {
      throw new Error(`${cell.task_id} lacks ${minRuns} successful economic runs`);
    }
    return {
      task_id: cell.task_id,
      target_steps: cell.target_steps,
      before: summarize(before),
      after: summarize(after),
      baseline: summarize(baseline),
      after_vs_before_cost_reduction: bootstrapReductionInterval(
        after.map((run) => run.cost), before.map((run) => run.cost), { seed: 0x51a7 + cell.target_steps },
      ),
      after_vs_baseline_cost_reduction: bootstrapReductionInterval(
        after.map((run) => run.cost), baseline.map((run) => run.cost), { seed: 0xb35e + cell.target_steps },
      ),
    };
  });
  return CurveCacheEconomicsSchema.parse({
    schema_version: 1,
    before_protocol_id: beforeAudit.subject_protocol_id,
    after_protocol_id: afterAudit.subject_protocol_id,
    baseline_protocol_id: afterAudit.baseline_protocol_id,
    provider: afterAudit.provider,
    model: afterAudit.model,
    successful_runs_per_harness: minRuns,
    pricing: {
      version: DEFAULT_PRICE_TABLE.version,
      source: afterAudit.provider === 'openai'
        ? 'https://developers.openai.com/api/docs/pricing'
        : DEFAULT_PRICE_TABLE.source,
    },
    cells,
  });
}

/** Writes deterministic cache-economics Markdown, SVG, and JSON artifacts. */
export async function writeCurveCacheEconomics(
  beforePath: string,
  afterPath: string,
  baselinePath: string,
  outputs: { markdown: string; svg: string; summary: string },
  options: BuildCurveCacheEconomicsOptions,
): Promise<CurveCacheEconomics> {
  const result = buildCurveCacheEconomics(
    parseCurveStepJsonl(await readFile(beforePath, 'utf8')),
    parseCurveStepJsonl(await readFile(afterPath, 'utf8')),
    parseCurveStepJsonl(await readFile(baselinePath, 'utf8')),
    options,
  );
  await Promise.all(Object.values(outputs).map((path) => mkdir(dirname(path), { recursive: true })));
  await Promise.all([
    writeFile(outputs.markdown, renderCurveCacheEconomics(result), 'utf8'),
    writeFile(outputs.svg, renderCurveCacheCostSvg(result), 'utf8'),
    writeFile(outputs.summary, `${JSON.stringify(result, null, 2)}\n`, 'utf8'),
  ]);
  return result;
}

/** Renders the provider-cache before/after economics table. */
export function renderCurveCacheEconomics(result: CurveCacheEconomics): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const tokens = (value: number) => Math.round(value).toLocaleString('en-US');
  const interval = (value: z.infer<typeof EconomicIntervalSchema>) => `${pct(value.point)} [${pct(value.lower)}–${pct(value.upper)}]`;
  const lines = [
    '# E3 provider-cache economics', '',
    `Before \`${result.before_protocol_id}\`; after \`${result.after_protocol_id}\`; baseline \`${result.baseline_protocol_id}\`; ${result.provider}/\`${result.model}\`; ${result.successful_runs_per_harness} successful runs per harness/cell. Costs use the ${result.pricing.version} published rates (${result.pricing.source}).`, '',
    'The fresh after/baseline matrix preserves G1 ordering: repetition outermost, checkpoints shortest-to-longest, and Rote immediately followed by Browser Use for every cell. The frozen before matrix remains unchanged. The cache key adds no prompt text.', '',
    '| Cell | Rote cost before | Rote cost after | Cost reduction (95% CI) | Browser Use cost | Rote vs Browser Use (95% CI) | Cache reads before → after | Hit-call rate before → after |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const cell of result.cells) {
    lines.push(`| ${cell.task_id} | $${cell.before.mean_cost_usd.toFixed(4)} | $${cell.after.mean_cost_usd.toFixed(4)} | ${interval(cell.after_vs_before_cost_reduction)} | $${cell.baseline.mean_cost_usd.toFixed(4)} | ${interval(cell.after_vs_baseline_cost_reduction)} | ${tokens(cell.before.mean_cache_read)} → ${tokens(cell.after.mean_cache_read)} | ${pct(cell.before.cache_hit_rate)} → ${pct(cell.after.cache_hit_rate)} |`);
  }
  const longest = result.cells.at(-1)!;
  lines.push('', `At ${longest.task_id}, stable cache routing cuts Rote's mean bill by ${pct(longest.after_vs_before_cost_reduction.point)} (${pct(longest.after_vs_before_cost_reduction.lower)}–${pct(longest.after_vs_before_cost_reduction.upper)}) and makes it ${pct(longest.after_vs_baseline_cost_reduction.point)} cheaper than Browser Use (${pct(longest.after_vs_baseline_cost_reduction.lower)}–${pct(longest.after_vs_baseline_cost_reduction.upper)}). Logical input remains separately reported and is not relabeled as a cache saving.`, '');
  return `${lines.join('\n')}\n`;
}

/** Renders mean billed cost across task length before and after stable cache routing. */
export function renderCurveCacheCostSvg(result: CurveCacheEconomics): string {
  const width = 820; const height = 470; const left = 85; const right = 30; const top = 45; const bottom = 75;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const steps = result.cells.map((cell) => cell.target_steps); const minStep = Math.min(...steps); const maxStep = Math.max(...steps);
  const maximum = Math.max(...result.cells.flatMap((cell) => [cell.before.mean_cost_usd, cell.after.mean_cost_usd, cell.baseline.mean_cost_usd])) * 1.12;
  const x = (value: number) => left + ((value - minStep) / (maxStep - minStep)) * plotWidth;
  const y = (value: number) => top + plotHeight - (value / maximum) * plotHeight;
  const path = (key: 'before' | 'after' | 'baseline') => result.cells.map((cell, index) => `${index ? 'L' : 'M'}${x(cell.target_steps).toFixed(1)},${y(cell[key].mean_cost_usd).toFixed(1)}`).join(' ');
  const dots = (key: 'before' | 'after' | 'baseline', color: string) => result.cells.map((cell) => `<circle cx="${x(cell.target_steps)}" cy="${y(cell[key].mean_cost_usd)}" r="4" fill="${color}"/>`).join('');
  const yTicks = Array.from({ length: 5 }, (_, index) => maximum * index / 4);
  const grid = yTicks.map((value) => `<g><line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#e5e7eb"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${(value * 100).toFixed(1)}¢</text></g>`).join('');
  const xTicks = result.cells.map((cell) => `<text x="${x(cell.target_steps)}" y="${height - bottom + 28}" text-anchor="middle">${cell.target_steps}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Billed cost before and after stable cache routing</title><desc id="desc">Rote's prompt cache key lowers billed cost across the WordPress curve and beats Browser Use at the longest checkpoint.</desc><rect width="100%" height="100%" fill="white"/><g font-family="system-ui,sans-serif" font-size="12" fill="#374151">${grid}${xTicks}<line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#111827"/><line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#111827"/><text x="${left + plotWidth / 2}" y="${height - 18}" text-anchor="middle" font-size="14">Required browser interactions</text><text transform="translate(20 ${top + plotHeight / 2}) rotate(-90)" text-anchor="middle" font-size="14">Mean billed cost (USD cents)</text><path d="${path('before')}" fill="none" stroke="#dc2626" stroke-width="3"/>${dots('before', '#dc2626')}<path d="${path('after')}" fill="none" stroke="#2563eb" stroke-width="3"/>${dots('after', '#2563eb')}<path d="${path('baseline')}" fill="none" stroke="#6b7280" stroke-width="3"/>${dots('baseline', '#6b7280')}<g transform="translate(${left + 15} ${top + 8})"><line x2="24" stroke="#dc2626" stroke-width="3"/><text x="31" y="4">Rote before</text><line x1="105" x2="129" stroke="#2563eb" stroke-width="3"/><text x="136" y="4">Rote cache-key</text><line x1="245" x2="269" stroke="#6b7280" stroke-width="3"/><text x="276" y="4">Browser Use</text></g></g></svg>\n`;
}

function economicRuns(records: readonly CurveStepRecord[], model: string): EconomicRun[] {
  const price = priceForModel(model);
  if (!price) throw new Error(`price unavailable for cache economics model ${model}`);
  const grouped = new Map<string, CurveStepRecord[]>();
  for (const record of records) {
    const rows = grouped.get(record.run_id) ?? []; rows.push(record); grouped.set(record.run_id, rows);
  }
  return [...grouped.values()].map((rows) => {
    const final = rows.at(-1)!;
    if (final.record_kind !== 'measurement' || final.step_outcome !== 'success' || final.verification_passed !== true) {
      throw new Error(`${final.run_id} is not a verified successful economic run`);
    }
    const input = rows.reduce((sum, row) => sum + row.usage.input_tokens, 0);
    const cacheRead = rows.reduce((sum, row) => sum + row.usage.cache_read_tokens, 0);
    const cacheWrite = rows.reduce((sum, row) => sum + row.usage.cache_write_tokens, 0);
    const output = rows.reduce((sum, row) => sum + row.usage.output_tokens, 0);
    return {
      taskId: final.task_id, targetSteps: final.target_steps,
      cost: runCostUsd(input, output, price, cacheRead, cacheWrite),
      logicalInput: input + cacheRead + cacheWrite,
      cacheRead,
      cacheHitCalls: rows.filter((row) => row.usage.cache_read_tokens > 0).length,
      calls: rows.length,
    };
  });
}

function summarize(runs: readonly EconomicRun[]) {
  return {
    mean_cost_usd: mean(runs.map((run) => run.cost)),
    mean_logical_input: mean(runs.map((run) => run.logicalInput)),
    mean_cache_read: mean(runs.map((run) => run.cacheRead)),
    cache_hit_rate: runs.reduce((sum, run) => sum + run.cacheHitCalls, 0) / runs.reduce((sum, run) => sum + run.calls, 0),
  };
}
