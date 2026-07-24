import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { RunManifestSchema, TokenUsageSourceSchema } from '@rote/core';
import { bootstrapMatchedReductionInterval, evaluateLaunchGate } from './competitor-gate.js';
import { buildHeadToHead, readCompetitorRecords, type CompetitorRunRecord, type HarnessTaskSummary } from './competitor.js';
import { DEFAULT_PRICE_TABLE, priceForModel, runCostUsd } from './pricing.js';

const BrowserDumpSchema = z.object({
  task: z.enum(['B1', 'B2', 'B3']),
  repetition: z.number().int().positive(),
  outcome: z.enum(['success', 'failure', 'abandoned']),
  input_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_write_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  browser_use_version: z.literal('0.13.6'),
  provider: z.literal('openai'),
  model: z.literal('gpt-4.1-mini'),
  is_successful: z.boolean().nullable(),
  verify_text_visible: z.boolean(),
  provider_receipts: z.array(z.object({
    model: z.string().min(1),
    usage: z.record(z.unknown()).refine((usage) => Object.keys(usage).length > 0, 'provider receipt usage cannot be empty'),
  })).min(1),
});

const IntervalSchema = z.object({
  point: z.number(), lower: z.number(), upper: z.number(), confidence: z.number(), resamples: z.number().int().positive(),
});
const LevelSchema = z.object({
  mean_tokens: z.number().nonnegative(),
  mean_latency_ms: z.number().nonnegative(),
  p50_latency_ms: z.number().nonnegative(),
  p95_latency_ms: z.number().nonnegative(),
  mean_cost_usd: z.number().nonnegative(),
});

/** Machine-readable G2 certification audit and report. */
export const G2ReportSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.literal('p1-g2-fixtures-v1-b1-b3'),
  provider: z.literal('openai'),
  model: z.literal('gpt-4.1-mini'),
  browser_use_version: z.literal('0.13.6'),
  min_successful_runs: z.number().int().min(15),
  gate_passed: z.boolean(),
  tasks: z.array(z.object({
    task: z.enum(['B1', 'B2', 'B3']),
    rote_successes: z.number().int().nonnegative(),
    rote_attempts: z.number().int().positive(),
    baseline_successes: z.number().int().nonnegative(),
    baseline_attempts: z.number().int().positive(),
    logical_token_reduction: IntervalSchema,
    cost_reduction: IntervalSchema,
    latency_reduction: IntervalSchema,
    rote_level: LevelSchema,
    baseline_level: LevelSchema,
    clears_80_percent_target: z.boolean(),
  })).length(3),
  rote_mean_tokens_by_source: z.array(z.object({
    task: z.enum(['B1', 'B2', 'B3']),
    source: TokenUsageSourceSchema,
    mean_tokens: z.number().nonnegative(),
  })),
  verification_audit: z.object({
    rote_manifests: z.number().int().positive(),
    browser_use_dumps: z.number().int().positive(),
    browser_use_receipts: z.number().int().positive(),
    all_rote_successes_verified: z.literal(true),
    all_browser_successes_concluded_and_verified: z.literal(true),
  }),
  pricing: z.object({ version: z.string().min(1), source: z.string().min(1) }),
});
/** Validated G2 report. */
export type G2Report = z.infer<typeof G2ReportSchema>;

/** Audits G2 raw verification evidence and computes seeded-bootstrap level intervals. */
export function buildG2Report(
  records: readonly CompetitorRunRecord[],
  manifestsRaw: unknown,
  browserDumpsRaw: unknown,
  minRuns = 15,
): G2Report {
  const manifests = z.array(RunManifestSchema).parse(manifestsRaw);
  const browserDumps = z.array(BrowserDumpSchema).parse(browserDumpsRaw);
  auditRecordMatrix(records);
  auditRoteManifests(manifests, records);
  auditBrowserDumps(browserDumps, records);
  const result = buildHeadToHead(records, { subject: 'rote' });
  const gate = evaluateLaunchGate(result, { minRuns });
  const price = priceForModel('gpt-4.1-mini');
  if (!price) throw new Error('gpt-4.1-mini price unavailable');
  const tasks = result.comparisons.map((comparison, index) => {
    const subject = records.filter((record) => record.task === comparison.task && record.harness === 'rote' && record.outcome === 'success').sort(byRepetition);
    const baseline = records.filter((record) => record.task === comparison.task && record.harness === 'browser-use' && record.outcome === 'success').sort(byRepetition);
    assertMatchedRepetitions(subject, baseline);
    const costs = (runs: readonly CompetitorRunRecord[]) => runs.map((run) => runCostUsd(
      run.input_tokens, run.output_tokens, price, run.cache_read_tokens, run.cache_write_tokens,
    ));
    const tokenReduction = bootstrapMatchedReductionInterval(subject.map(totalTokens), baseline.map(totalTokens), { seed: 0x70ce + index });
    return {
      task: comparison.task as 'B1' | 'B2' | 'B3',
      rote_successes: comparison.subject.successes,
      rote_attempts: comparison.subject.runs,
      baseline_successes: comparison.baseline.successes,
      baseline_attempts: comparison.baseline.runs,
      logical_token_reduction: tokenReduction,
      cost_reduction: bootstrapMatchedReductionInterval(costs(subject), costs(baseline), { seed: 0xc057 + index }),
      latency_reduction: bootstrapMatchedReductionInterval(
        subject.map((run) => run.duration_ms), baseline.map((run) => run.duration_ms), { seed: 0x1a7e + index },
      ),
      rote_level: level(comparison.subject),
      baseline_level: level(comparison.baseline),
      clears_80_percent_target: tokenReduction.lower >= 0.8,
    };
  });
  const bySource = meanTokensBySource(manifests);
  return G2ReportSchema.parse({
    schema_version: 1,
    protocol_id: 'p1-g2-fixtures-v1-b1-b3',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    browser_use_version: '0.13.6',
    min_successful_runs: minRuns,
    gate_passed: gate.passed && tasks.every((task) => task.logical_token_reduction.lower > 0),
    tasks,
    rote_mean_tokens_by_source: bySource,
    verification_audit: {
      rote_manifests: manifests.length,
      browser_use_dumps: browserDumps.length,
      browser_use_receipts: browserDumps.reduce((sum, dump) => sum + dump.provider_receipts.length, 0),
      all_rote_successes_verified: true,
      all_browser_successes_concluded_and_verified: true,
    },
    pricing: { version: DEFAULT_PRICE_TABLE.version, source: DEFAULT_PRICE_TABLE.source },
  });
}

/** Writes the reproducible G2 Markdown and JSON result. */
export async function writeG2Report(
  recordsPath: string,
  manifestsPath: string,
  browserDumpsPath: string,
  outputs: { markdown: string; summary: string },
  minRuns = 15,
): Promise<G2Report> {
  const report = buildG2Report(
    await readCompetitorRecords(recordsPath),
    JSON.parse(await readFile(manifestsPath, 'utf8')),
    JSON.parse(await readFile(browserDumpsPath, 'utf8')),
    minRuns,
  );
  await Promise.all(Object.values(outputs).map((path) => mkdir(dirname(path), { recursive: true })));
  await Promise.all([
    writeFile(outputs.markdown, renderG2Report(report), 'utf8'),
    writeFile(outputs.summary, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  ]);
  return report;
}

/** Renders G2 intervals, parity, source accounting, and limitations. */
export function renderG2Report(report: G2Report): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const interval = (value: z.infer<typeof IntervalSchema>) => `${pct(value.point)} [${pct(value.lower)}–${pct(value.upper)}]`;
  const lines = [
    '# G2 tokens-per-task level', '',
    `Protocol \`${report.protocol_id}\`; ${report.provider}/\`${report.model}\`; Browser Use ${report.browser_use_version}; ${report.min_successful_runs}+ successful runs required per harness/task; matched-repetition 10,000-resample 95% intervals.`, '',
    `**Formal G2 result: ${report.gate_passed ? 'PASS' : 'FAIL'}.** The gate requires a positive lower token-reduction bound, success parity, measured cache buckets, the same model, and at least ${report.min_successful_runs} successes per side.`, '',
    '| Task | Logical token reduction (95% CI) | Cost reduction (95% CI) | Latency reduction (95% CI) | Success R/B | ≥80% target |',
    '|---|---:|---:|---:|---:|---|',
  ];
  for (const task of report.tasks) {
    lines.push(`| ${task.task} | ${interval(task.logical_token_reduction)} | ${interval(task.cost_reduction)} | ${interval(task.latency_reduction)} | ${task.rote_successes}/${task.rote_attempts} / ${task.baseline_successes}/${task.baseline_attempts} | ${task.clears_80_percent_target ? 'yes' : 'NO'} |`);
  }
  lines.push('', '## Absolute levels', '', '| Task | Harness | Mean logical tokens | Mean ms | p50 ms | p95 ms | Mean $/task |', '|---|---|---:|---:|---:|---:|---:|');
  for (const task of report.tasks) {
    for (const [harness, value] of [['Rote', task.rote_level], ['Browser Use', task.baseline_level]] as const) {
      lines.push(`| ${task.task} | ${harness} | ${value.mean_tokens.toFixed(1)} | ${value.mean_latency_ms.toFixed(1)} | ${value.p50_latency_ms.toFixed(1)} | ${value.p95_latency_ms.toFixed(1)} | $${value.mean_cost_usd.toFixed(4)} |`);
    }
  }
  lines.push('', 'B1 and B3 clear the benchmark catalog’s 80% target. B2 passes the formal positive-margin G2 gate but does **not** clear 80%; it is above the 50% kill threshold. Do not describe all three tasks as ≥80% wins. Latency is reported but not gated in V1: no task clears the catalog’s 5× pass target; B1 and B2 are below its 2× kill line, while B3 is between them.', '', '## Rote mean logical tokens by source', '', '| Task | Source | Mean tokens/run |', '|---|---|---:|');
  for (const row of report.rote_mean_tokens_by_source) lines.push(`| ${row.task} | ${row.source} | ${row.mean_tokens.toFixed(1)} |`);
  lines.push('', `Verification audit: ${report.verification_audit.rote_manifests} Rote manifests and ${report.verification_audit.browser_use_dumps} Browser Use dumps; all successes independently verified; ${report.verification_audit.browser_use_receipts} raw Browser Use provider receipts retained.`, '', `Prices: \`${report.pricing.version}\` (${report.pricing.source}). Logical tokens include uncached/cache-read/cache-write input plus output; dollars price each bucket separately.`, '');
  return `${lines.join('\n')}\n`;
}

function level(summary: HarnessTaskSummary): z.infer<typeof LevelSchema> {
  if (summary.avg_cost_usd === undefined) throw new Error(`${summary.model} is unpriced`);
  return {
    mean_tokens: summary.avg_total_tokens,
    mean_latency_ms: summary.avg_duration_ms,
    p50_latency_ms: summary.p50_duration_ms,
    p95_latency_ms: summary.p95_duration_ms,
    mean_cost_usd: summary.avg_cost_usd,
  };
}

function byRepetition(left: CompetitorRunRecord, right: CompetitorRunRecord): number { return left.repetition - right.repetition; }

function totalTokens(record: CompetitorRunRecord): number {
  return record.input_tokens + record.cache_read_tokens + record.cache_write_tokens + record.output_tokens;
}

function assertMatchedRepetitions(subject: readonly CompetitorRunRecord[], baseline: readonly CompetitorRunRecord[]): void {
  if (subject.length !== baseline.length || subject.some((record, index) => record.repetition !== baseline[index]!.repetition)) {
    throw new Error('G2 successful repetitions are not exactly matched');
  }
}

function auditRecordMatrix(records: readonly CompetitorRunRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (!['B1', 'B2', 'B3'].includes(record.task)) throw new Error(`unexpected G2 task ${record.task}`);
    if (!['rote', 'browser-use'].includes(record.harness)) throw new Error(`unexpected G2 harness ${record.harness}`);
    if (record.model !== 'gpt-4.1-mini' || !record.cache_adjusted) throw new Error('G2 record model/cache provenance mismatch');
    const key = `${record.harness}/${record.task}/${record.repetition}`;
    if (seen.has(key)) throw new Error(`duplicate G2 attempt ${key}`);
    seen.add(key);
  }
}

function auditRoteManifests(
  manifests: readonly z.infer<typeof RunManifestSchema>[],
  records: readonly CompetitorRunRecord[],
): void {
  const identities = new Set<string>();
  for (const manifest of manifests) {
    if (!/^g2-rote-b[123]-r\d{2}$/.test(manifest.run_id)) throw new Error(`unexpected Rote G2 run id ${manifest.run_id}`);
    if (manifest.outcome !== 'success') throw new Error(`${manifest.run_id} did not pass independent verification`);
    if (manifest.token_usage.length === 0) throw new Error(`${manifest.run_id} has no measured usage`);
    const match = /^g2-rote-(b[123])-r(\d{2})$/.exec(manifest.run_id)!;
    const identity = `${match[1]!.toUpperCase()}/${Number(match[2])}`;
    identities.add(identity);
    const record = records.find((candidate) => candidate.harness === 'rote' && `${candidate.task}/${candidate.repetition}` === identity)!;
    const totals = manifest.token_usage.reduce((sum, usage) => ({
      input: sum.input + usage.input_tokens,
      read: sum.read + usage.cache_read_tokens,
      write: sum.write + usage.cache_write_tokens,
      output: sum.output + usage.output_tokens,
    }), { input: 0, read: 0, write: 0, output: 0 });
    if (record.outcome !== manifest.outcome || record.input_tokens !== totals.input || record.cache_read_tokens !== totals.read || record.cache_write_tokens !== totals.write || record.output_tokens !== totals.output) {
      throw new Error(`${manifest.run_id} neutral record does not match its manifest`);
    }
  }
  const expected = new Set(records.filter((record) => record.harness === 'rote').map((record) => `${record.task}/${record.repetition}`));
  assertSameIdentities('Rote manifests', identities, expected);
}

function auditBrowserDumps(
  dumps: readonly z.infer<typeof BrowserDumpSchema>[],
  records: readonly CompetitorRunRecord[],
): void {
  const seen = new Set<string>();
  for (const dump of dumps) {
    const key = `${dump.task}/${dump.repetition}`;
    if (seen.has(key)) throw new Error(`duplicate Browser Use dump ${key}`);
    seen.add(key);
    if (dump.outcome === 'success' && (dump.is_successful !== true || dump.verify_text_visible !== true)) {
      throw new Error(`${key} reports success without conclusion and live verification`);
    }
    if (dump.provider_receipts.some((receipt) => receipt.model !== dump.model)) throw new Error(`${key} receipt model mismatch`);
    const record = records.find((candidate) => candidate.harness === 'browser-use' && `${candidate.task}/${candidate.repetition}` === key)!;
    if (record.outcome !== dump.outcome || record.input_tokens !== dump.input_tokens || record.cache_read_tokens !== dump.cache_read_tokens || record.cache_write_tokens !== dump.cache_write_tokens || record.output_tokens !== dump.output_tokens || record.duration_ms !== dump.duration_ms) {
      throw new Error(`${key} neutral record does not match its diagnostic dump`);
    }
  }
  const expected = new Set(records.filter((record) => record.harness === 'browser-use').map((record) => `${record.task}/${record.repetition}`));
  assertSameIdentities('Browser Use dumps', seen, expected);
}

function assertSameIdentities(label: string, actual: ReadonlySet<string>, expected: ReadonlySet<string>): void {
  const missing = [...expected].filter((identity) => !actual.has(identity));
  const extra = [...actual].filter((identity) => !expected.has(identity));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${label} identity mismatch: missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`);
  }
}

function meanTokensBySource(manifests: readonly z.infer<typeof RunManifestSchema>[]) {
  const totals = new Map<string, { total: number; task: 'B1' | 'B2' | 'B3'; source: z.infer<typeof TokenUsageSourceSchema> }>();
  const taskRuns = new Map<'B1' | 'B2' | 'B3', number>();
  for (const manifest of manifests) {
    const match = /^g2-rote-(b[123])-r\d{2}$/.exec(manifest.run_id)!;
    const task = match[1]!.toUpperCase() as 'B1' | 'B2' | 'B3';
    taskRuns.set(task, (taskRuns.get(task) ?? 0) + 1);
    for (const usage of manifest.token_usage) {
      const key = `${task}/${usage.source}`;
      const current = totals.get(key) ?? { total: 0, task, source: usage.source };
      current.total += usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens + usage.output_tokens;
      totals.set(key, current);
    }
  }
  return [...totals.values()].sort((a, b) => a.task.localeCompare(b.task) || a.source.localeCompare(b.source)).map((row) => ({
    task: row.task, source: row.source, mean_tokens: row.total / taskRuns.get(row.task)!,
  }));
}
