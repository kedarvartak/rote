import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CompetitorRunRecordSchema } from './competitor.js';
import { mean, wilsonInterval } from './stats.js';

export const B5MutationRecordSchema = z.object({
  protocol_id: z.literal('p1-b5-b2-drift-v1'),
  mutation: z.string().min(1),
  expectation: z.enum(['recover', 'fail_closed']),
  repetition: z.number().int().positive(),
  outcome: z.enum(['repaired_success', 'detected_fallback', 'failure', 'silent_failure']),
  repaired_steps: z.number().int().nonnegative(),
  logical_tokens: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
  exact_live_verification: z.boolean(),
});
export type B5MutationRecord = z.infer<typeof B5MutationRecordSchema>;

export const B5ReportSchema = z.object({
  protocol_id: z.literal('p1-b5-b2-drift-v1'),
  certified: z.boolean(),
  repetitions_per_mutation: z.number().int().positive(),
  recoverable_mutations: z.number().int().positive(),
  fail_closed_mutations: z.number().int().positive(),
  drift_recovery_rate: z.number().min(0).max(1),
  drift_recovery_interval_95: z.tuple([z.number(), z.number()]),
  silent_failure_rate: z.number().min(0).max(1),
  silent_failure_interval_95: z.tuple([z.number(), z.number()]),
  fail_closed_rate: z.number().min(0).max(1),
  fail_closed_interval_95: z.tuple([z.number(), z.number()]),
  mean_repair_cost_ratio: z.number().nonnegative(),
  mean_repaired_steps: z.number().nonnegative(),
  mean_repaired_run_duration_ms: z.number().nonnegative(),
  cold_baseline_mean_logical_tokens: z.number().positive(),
  attempts: z.number().int().positive(),
});
export type B5Report = z.infer<typeof B5ReportSchema>;

/** Audits deterministic B5 drift receipts against the catalog's recovery, safety, and cost gates. */
export function buildB5Report(
  input: readonly B5MutationRecord[],
  coldRecords: readonly unknown[],
  minRuns = 15,
): B5Report {
  const records = z.array(B5MutationRecordSchema).min(1).parse(input);
  const baseline = z.array(CompetitorRunRecordSchema).parse(coldRecords)
    .filter((record) => record.harness === 'rote' && record.task === 'B2' && record.outcome === 'success');
  if (baseline.length < minRuns) throw new Error(`B5 requires ${minRuns}+ successful Rote B2 cold baselines`);

  const groups = new Map<string, B5MutationRecord[]>();
  for (const record of records) {
    const values = groups.get(record.mutation) ?? [];
    values.push(record);
    groups.set(record.mutation, values);
  }
  for (const [mutation, values] of groups) {
    if (values.length < minRuns) throw new Error(`${mutation} has ${values.length} attempts; ${minRuns} required`);
    if (new Set(values.map((value) => value.repetition)).size !== values.length) {
      throw new Error(`${mutation} contains duplicate repetitions`);
    }
    if (new Set(values.map((value) => value.expectation)).size !== 1) {
      throw new Error(`${mutation} mixes expectations`);
    }
  }

  const recoverable = records.filter((record) => record.expectation === 'recover');
  const failClosed = records.filter((record) => record.expectation === 'fail_closed');
  const repaired = recoverable.filter((record) => record.outcome === 'repaired_success' && record.exact_live_verification);
  const silent = records.filter((record) => record.outcome === 'silent_failure' || (record.outcome === 'repaired_success' && !record.exact_live_verification));
  const detected = failClosed.filter((record) => record.outcome === 'detected_fallback' && !record.exact_live_verification);
  const coldMean = mean(baseline.map((record) => record.input_tokens + record.cache_read_tokens + record.cache_write_tokens + record.output_tokens));
  const repairMean = mean(repaired.map((record) => record.logical_tokens));
  const driftRecoveryRate = repaired.length / recoverable.length;
  const silentFailureRate = silent.length / records.length;
  const failClosedRate = detected.length / failClosed.length;
  const repairCostRatio = repairMean / coldMean;
  const recoveryInterval = wilsonInterval(repaired.length, recoverable.length);
  const silentInterval = wilsonInterval(silent.length, records.length);
  const failClosedInterval = wilsonInterval(detected.length, failClosed.length);

  return B5ReportSchema.parse({
    protocol_id: 'p1-b5-b2-drift-v1',
    certified: recoveryInterval[0] >= 0.7 && silentFailureRate === 0 && failClosedRate === 1 && repairCostRatio <= 0.25,
    repetitions_per_mutation: Math.min(...[...groups.values()].map((values) => values.length)),
    recoverable_mutations: new Set(recoverable.map((record) => record.mutation)).size,
    fail_closed_mutations: new Set(failClosed.map((record) => record.mutation)).size,
    drift_recovery_rate: driftRecoveryRate,
    drift_recovery_interval_95: recoveryInterval,
    silent_failure_rate: silentFailureRate,
    silent_failure_interval_95: silentInterval,
    fail_closed_rate: failClosedRate,
    fail_closed_interval_95: failClosedInterval,
    mean_repair_cost_ratio: repairCostRatio,
    mean_repaired_steps: mean(repaired.map((record) => record.repaired_steps)),
    mean_repaired_run_duration_ms: mean(repaired.map((record) => record.duration_ms)),
    cold_baseline_mean_logical_tokens: coldMean,
    attempts: records.length,
  });
}

/** Writes the B5 machine summary and human-readable audit report. */
export async function writeB5Report(
  recordsPath: string,
  coldRecordsPath: string,
  outPath: string,
  summaryPath: string,
  minRuns = 15,
): Promise<B5Report> {
  const text = await readFile(recordsPath, 'utf8');
  const records = text.trimStart().startsWith('[')
    ? JSON.parse(text) as unknown[]
    : text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
  const cold = JSON.parse(await readFile(coldRecordsPath, 'utf8')) as unknown[];
  const report = buildB5Report(z.array(B5MutationRecordSchema).parse(records), cold, minRuns);
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(outPath, renderB5Report(report));
  return report;
}

/** Renders the audited B5 result without claiming generic transactional rollback. */
export function renderB5Report(report: B5Report): string {
  return `# B5 deterministic drift certification\n\nProtocol \`${report.protocol_id}\`; ${report.repetitions_per_mutation}+ attempts per mutation.\n\n**Result: ${report.certified ? 'PASS' : 'FAIL'}.**\n\n| Metric | Result | Gate |\n|---|---:|---:|\n| Drift recovery without full fallback | ${percentInterval(report.drift_recovery_rate, report.drift_recovery_interval_95)} | 95% lower bound ≥70% |\n| Silent failure | ${percentInterval(report.silent_failure_rate, report.silent_failure_interval_95)} | 0 observed |\n| Adversarial fail-closed | ${percentInterval(report.fail_closed_rate, report.fail_closed_interval_95)} | 100% observed |\n| Repair/cold logical-token ratio | ${(report.mean_repair_cost_ratio * 100).toFixed(1)}% | ≤25% |\n| Mean repaired steps | ${report.mean_repaired_steps.toFixed(1)} | report |\n| Mean repaired-run latency | ${report.mean_repaired_run_duration_ms.toFixed(1)} ms | report |\n\n${report.attempts} deterministic real-Chrome attempts cover ${report.recoverable_mutations} recoverable mutation classes and ${report.fail_closed_mutations} adversarial ambiguity class. The cold denominator is ${report.cold_baseline_mean_logical_tokens.toFixed(1)} logical tokens from the corrected T20 B2 matrix. Repair here means deterministic semantic target resolution before dispatch; it is not generic rollback or an LLM repair agent.\n`;
}

function percentInterval(point: number, interval: readonly [number, number]): string {
  return `${(point * 100).toFixed(1)}% [${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)}%]`;
}


