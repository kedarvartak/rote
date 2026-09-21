import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CompetitorRunRecordSchema, type CompetitorRunRecord } from './competitor.js';
import { wilsonInterval } from './stats.js';

const PACKAGE_INTEGRITY = 'sha512-kfwfc8D4qo1JMcROhXRgPS1FTXPbtQnI8tHGJ2AXMDdUZWiD8+VHgHHBJcss0s/PqSkDmaaj4XOKzK0+iSwx0w==';
const PACKAGE_SHASUM = 'c21a57a282a27058e146923b2b9a46bdbaa79779';
const NPM_GIT_HEAD = 'f1b587c4173d8242bdb551991de54e70c4d2faf3';
const VERIFY_TEXT = 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148';

const AggregateUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_write_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
const RawProviderReceiptSchema = z.object({
  provider: z.literal('openai'),
  model: z.literal('gpt-4.1-mini'),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    input_tokens_details: z.object({
      cached_tokens: z.number().int().nonnegative().optional(),
      cache_write_tokens: z.number().int().nonnegative().optional(),
    }).optional(),
  }),
}).passthrough();

/** One append-only Magnitude cold qualification attempt with independent exact verification. */
export const MagnitudeQualificationReceiptSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.literal('magnitude-core-v0.3.1-b2-qualification-v1'),
  harness: z.literal('magnitude-core'),
  harness_version: z.literal('0.3.1'),
  package_integrity: z.literal(PACKAGE_INTEGRITY),
  package_shasum: z.literal(PACKAGE_SHASUM),
  npm_git_head: z.literal(NPM_GIT_HEAD),
  provider: z.literal('openai'),
  model: z.literal('gpt-4.1-mini'),
  viewport: z.object({ width: z.literal(1920), height: z.literal(1080) }),
  task: z.literal('B2'),
  phase: z.literal('cold'),
  mutation: z.literal('canonical'),
  attempt: z.number().int().positive(),
  initial_url: z.literal('http://127.0.0.1:8094/b2-vendor-form.html'),
  verify_text: z.literal(VERIFY_TEXT),
  harness_success: z.boolean(),
  exact_live_verification: z.boolean(),
  outcome: z.enum(['exact_success', 'silent_failure', 'verification_only', 'timeout', 'failure', 'abandoned']),
  aggregate_usage: AggregateUsageSchema.nullable(),
  aggregate_usage_events: z.array(z.unknown()).nullable(),
  raw_provider_receipts: z.array(RawProviderReceiptSchema),
  provider_receipts_complete: z.boolean(),
  duration_ms: z.number().int().nonnegative().nullable(),
  action_count: z.number().int().nonnegative().nullable(),
  magnitude_actions: z.array(z.unknown()),
  observed_body_text: z.string(),
  final_url: z.string().nullable(),
  error: z.string().nullable(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
}).strict();
/** Validated Magnitude qualification receipt. */
export type MagnitudeQualificationReceipt = z.infer<typeof MagnitudeQualificationReceiptSchema>;

/** Deterministic feasibility decision that cannot imply a comparative ranking. */
export const MagnitudeQualificationSummarySchema = z.object({
  protocol_id: z.literal('magnitude-core-v0.3.1-b2-qualification-v1'),
  certification_eligible: z.boolean(),
  decision: z.enum(['qualify_for_certification', 'stop_before_certification']),
  cold_attempts: z.number().int().positive(),
  cold_exact_successes: z.number().int().nonnegative(),
  cold_harness_conclusions: z.number().int().nonnegative(),
  cold_exact_success_rate: z.number().min(0).max(1),
  cold_exact_success_interval_95: z.tuple([z.number(), z.number()]),
  timeouts: z.number().int().nonnegative(),
  abandoned_attempts: z.number().int().nonnegative(),
  observed_silent_failures: z.number().int().nonnegative(),
  complete_raw_provider_receipt_sets: z.number().int().nonnegative(),
  aggregate_usage_attempts: z.number().int().nonnegative(),
  aggregate_usage_events: z.number().int().nonnegative(),
  total_actions_observed: z.number().int().nonnegative(),
  diagnostic_records: z.number().int().nonnegative(),
  b5_attempts: z.number().int().nonnegative(),
  disqualifications: z.array(z.string().min(1)),
});
/** Audited Magnitude feasibility summary. */
export type MagnitudeQualificationSummary = z.infer<typeof MagnitudeQualificationSummarySchema>;

/** Audits Magnitude exactness, timeout, provenance, and raw-receipt gates before certification. */
export function buildMagnitudeQualification(
  input: readonly MagnitudeQualificationReceipt[],
): { summary: MagnitudeQualificationSummary; records: CompetitorRunRecord[] } {
  const receipts = z.array(MagnitudeQualificationReceiptSchema).min(1).parse(input);
  const attempts = new Set<number>();
  for (const receipt of receipts) {
    if (attempts.has(receipt.attempt)) throw new Error(`duplicate Magnitude attempt ${receipt.attempt}`);
    attempts.add(receipt.attempt);
    if (receipt.harness_success && !receipt.exact_live_verification && receipt.outcome !== 'silent_failure') {
      throw new Error(`Magnitude attempt ${receipt.attempt} hides failed independent verification behind ${receipt.outcome}`);
    }
    if (receipt.provider_receipts_complete) {
      if (receipt.raw_provider_receipts.length === 0 || receipt.aggregate_usage === null) {
        throw new Error(`Magnitude attempt ${receipt.attempt} claims complete provider receipts without auditable usage`);
      }
      const rawUsage = normalizeRawProviderReceipts(receipt.raw_provider_receipts);
      if (JSON.stringify(rawUsage) !== JSON.stringify(receipt.aggregate_usage)) {
        throw new Error(`Magnitude attempt ${receipt.attempt} aggregate usage does not reconcile to raw provider receipts`);
      }
    }
    if (receipt.aggregate_usage === null && receipt.aggregate_usage_events !== null) {
      throw new Error(`Magnitude attempt ${receipt.attempt} has aggregate events without normalized usage`);
    }
  }
  const exact = receipts.filter((receipt) => receipt.harness_success && receipt.exact_live_verification);
  const silent = receipts.filter((receipt) => receipt.harness_success && !receipt.exact_live_verification);
  const complete = receipts.filter((receipt) => receipt.provider_receipts_complete);
  const disqualifications: string[] = [];
  if (exact.length < 3) disqualifications.push(`only ${exact.length} exact cold successes in ${receipts.length} attempts; 3 required`);
  if (silent.length > 0) disqualifications.push(`${silent.length} harness-declared successes failed the independent exact oracle`);
  if (complete.length < receipts.length) disqualifications.push(`raw provider receipts are incomplete for ${receipts.length - complete.length}/${receipts.length} attempts; token and cost ranking prohibited`);
  const certificationEligible = disqualifications.length === 0;
  const records = receipts.flatMap((receipt) => receipt.aggregate_usage && receipt.duration_ms !== null ? [toCompetitorRecord(receipt)] : []);
  const summary = MagnitudeQualificationSummarySchema.parse({
    protocol_id: 'magnitude-core-v0.3.1-b2-qualification-v1',
    certification_eligible: certificationEligible,
    decision: certificationEligible ? 'qualify_for_certification' : 'stop_before_certification',
    cold_attempts: receipts.length,
    cold_exact_successes: exact.length,
    cold_harness_conclusions: receipts.filter((receipt) => receipt.harness_success).length,
    cold_exact_success_rate: exact.length / receipts.length,
    cold_exact_success_interval_95: wilsonInterval(exact.length, receipts.length),
    timeouts: receipts.filter((receipt) => receipt.outcome === 'timeout').length,
    abandoned_attempts: receipts.filter((receipt) => receipt.outcome === 'abandoned').length,
    observed_silent_failures: silent.length,
    complete_raw_provider_receipt_sets: complete.length,
    aggregate_usage_attempts: receipts.filter((receipt) => receipt.aggregate_usage !== null).length,
    aggregate_usage_events: receipts.reduce((sum, receipt) => sum + (receipt.aggregate_usage_events?.length ?? 0), 0),
    total_actions_observed: receipts.reduce((sum, receipt) => sum + (receipt.action_count ?? 0), 0),
    diagnostic_records: records.length,
    b5_attempts: 0,
    disqualifications,
  });
  return { summary, records };
}

/** Writes audited diagnostics and a bounded Magnitude go/stop decision. */
export async function writeMagnitudeQualification(
  receiptsPath: string,
  recordsPath: string,
  reportPath: string,
  summaryPath: string,
): Promise<MagnitudeQualificationSummary> {
  const receipts = (await readFile(receiptsPath, 'utf8')).split('\n').filter(Boolean)
    .map((line) => MagnitudeQualificationReceiptSchema.parse(JSON.parse(line)));
  const { summary, records } = buildMagnitudeQualification(receipts);
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(reportPath, renderMagnitudeQualification(summary));
  return summary;
}

/** Renders Magnitude feasibility without promoting aggregate telemetry into a ranking. */
export function renderMagnitudeQualification(summary: MagnitudeQualificationSummary): string {
  const interval = summary.cold_exact_success_interval_95;
  return `# Magnitude 0.3.1 corrected-B2 feasibility\n\n**Decision: ${summary.certification_eligible ? 'QUALIFY for certification' : 'STOP before certification'}.** ${summary.certification_eligible ? 'The pinned adapter clears bounded feasibility.' : 'The pinned adapter did not qualify a publishable comparative cell.'}\n\n| Audit | Result |\n|---|---:|\n| Cold exact success | ${summary.cold_exact_successes}/${summary.cold_attempts} (${(summary.cold_exact_success_rate * 100).toFixed(1)}%, 95% Wilson ${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)}%) |\n| Harness-declared success | ${summary.cold_harness_conclusions}/${summary.cold_attempts} |\n| Frozen 90 s timeouts | ${summary.timeouts}/${summary.cold_attempts} |\n| Abandoned attempts | ${summary.abandoned_attempts} |\n| Observed harness-success / oracle-failure cases | ${summary.observed_silent_failures} |\n| Complete raw provider receipt sets | ${summary.complete_raw_provider_receipt_sets}/${summary.cold_attempts} |\n| Attempts with aggregate usage events | ${summary.aggregate_usage_attempts}/${summary.cold_attempts} |\n| Aggregate usage events retained | ${summary.aggregate_usage_events} |\n| Actions observed before termination | ${summary.total_actions_observed} |\n| B5 attempts | ${summary.b5_attempts} |\n\n## Disqualifications\n\n${summary.disqualifications.map((reason) => `- ${reason}`).join('\n')}\n\nMagnitude usage events remain diagnostic because complete raw provider responses were unavailable. This report publishes no Magnitude-vs-Rote token, cost, latency, or universal reliability claim. Timed-out and abandoned attempts remain in the denominator; missing usage is not zero. B5 was not run after corrected B2 failed the qualification gates.\n`;
}

function toCompetitorRecord(receipt: MagnitudeQualificationReceipt): CompetitorRunRecord {
  return CompetitorRunRecordSchema.parse({
    harness: 'magnitude',
    task: 'B2-cold-canonical',
    model: receipt.model,
    repetition: receipt.attempt,
    outcome: receipt.harness_success && receipt.exact_live_verification ? 'success' : 'failure',
    ...receipt.aggregate_usage!,
    duration_ms: receipt.duration_ms!,
    cache_adjusted: true,
    config_notes: `Magnitude 0.3.1 cold vision agent; aggregate telemetry only; raw_provider_receipts_complete=${receipt.provider_receipts_complete}`,
  });
}

function normalizeRawProviderReceipts(
  receipts: readonly z.infer<typeof RawProviderReceiptSchema>[],
): z.infer<typeof AggregateUsageSchema> {
  return receipts.reduce((total, receipt) => {
    const read = receipt.usage.input_tokens_details?.cached_tokens ?? 0;
    const write = receipt.usage.input_tokens_details?.cache_write_tokens ?? 0;
    if (receipt.usage.input_tokens < read + write) throw new Error('Magnitude raw receipt cache buckets exceed input tokens');
    return {
      input_tokens: total.input_tokens + receipt.usage.input_tokens - read - write,
      cache_read_tokens: total.cache_read_tokens + read,
      cache_write_tokens: total.cache_write_tokens + write,
      output_tokens: total.output_tokens + receipt.usage.output_tokens,
    };
  }, { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });
}

