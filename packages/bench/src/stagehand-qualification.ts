import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CompetitorRunRecordSchema, type CompetitorRunRecord } from './competitor.js';

const STAGEHAND_INTEGRITY = 'sha512-vAuYSZWIhh3d76BxwppNVE3dB0ztEBLBi85G6TWulZNiebdWptNoANOMuprOB/cw5dE+80b/ZZQo4G33Pc9i6w==';
const VERIFY_TEXT = 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148';

export const StagehandQualificationReceiptSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.literal('stagehand-v3.7.1-b2-b5-qualification-v1'),
  harness: z.literal('stagehand'),
  harness_version: z.literal('3.7.1'),
  package_integrity: z.literal(STAGEHAND_INTEGRITY),
  provider: z.literal('openai'),
  model: z.literal('openai/gpt-4.1-mini'),
  viewport: z.object({ width: z.literal(1920), height: z.literal(1080) }),
  task: z.literal('B2'),
  phase: z.enum(['cold', 'warm', 'drift']),
  mutation: z.enum(['canonical', 'fields-renamed', 'submit-renamed', 'wrappers', 'stale-selector-decoys', 'ambiguous-company']),
  repetition: z.number().int().positive(),
  initial_url: z.literal('http://127.0.0.1:8091/b2-vendor-form.html'),
  verify_text: z.literal(VERIFY_TEXT),
  harness_success: z.boolean(),
  exact_live_verification: z.boolean(),
  outcome: z.enum(['cold_success', 'cached_success', 'repaired_success', 'model_assisted_cache_success', 'full_fallback_success', 'cold_miss_success', 'silent_failure', 'verification_failure', 'failure']),
  cache_hit: z.boolean(),
  cache_updated: z.boolean(),
  replay_failed: z.boolean(),
  cache_identity_before: z.string().length(64),
  cache_identity_after: z.string().length(64),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    cache_read_tokens: z.number().int().nonnegative(),
    cache_write_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
  stagehand_metrics: z.record(z.string(), z.number()),
  stagehand_result_usage: z.unknown().nullable(),
  raw_provider_receipts: z.array(z.unknown()),
  provider_receipts_complete: z.boolean(),
  duration_ms: z.number().nonnegative(),
  action_count: z.number().int().nonnegative(),
  conclusion: z.string().nullable(),
  observed_body_text: z.string(),
  stagehand_actions: z.array(z.unknown()),
  error: z.string().nullable(),
  cache_logs: z.array(z.unknown()),
}).strict();
export type StagehandQualificationReceipt = z.infer<typeof StagehandQualificationReceiptSchema>;

export const StagehandQualificationSummarySchema = z.object({
  protocol_id: z.literal('stagehand-v3.7.1-b2-b5-qualification-v1'),
  certification_eligible: z.boolean(),
  decision: z.enum(['qualify_for_certification', 'stop_before_certification']),
  cold_attempts: z.number().int().positive(),
  cold_exact_successes: z.number().int().nonnegative(),
  cold_harness_conclusions: z.number().int().nonnegative(),
  cold_exact_success_rate: z.number().min(0).max(1),
  cold_exact_success_interval_95: z.tuple([z.number(), z.number()]),
  complete_paired_repetitions: z.number().int().nonnegative(),
  drift_attempts: z.number().int().nonnegative(),
  drift_exact_successes: z.number().int().nonnegative(),
  observed_silent_failures: z.number().int().nonnegative(),
  cold_receipts_complete: z.number().int().nonnegative(),
  warm_drift_receipts_complete: z.number().int().nonnegative(),
  warm_drift_attempts: z.number().int().nonnegative(),
  disqualifications: z.array(z.string().min(1)),
});
export type StagehandQualificationSummary = z.infer<typeof StagehandQualificationSummarySchema>;

/** Audits Stagehand qualification receipts and stops unreliable or unpriceable cells before certification. */
export function buildStagehandQualification(
  input: readonly StagehandQualificationReceipt[],
): { summary: StagehandQualificationSummary; records: CompetitorRunRecord[] } {
  const receipts = z.array(StagehandQualificationReceiptSchema).min(1).parse(input);
  const identities = new Set<string>();
  for (const receipt of receipts) {
    const key = `${receipt.phase}:${receipt.mutation}:${receipt.repetition}`;
    if (identities.has(key)) throw new Error(`duplicate Stagehand receipt ${key}`);
    identities.add(key);
    if (receipt.harness_success && !receipt.exact_live_verification && !['silent_failure', 'verification_failure'].includes(receipt.outcome)) {
      throw new Error(`${key} hides failed independent verification behind ${receipt.outcome}`);
    }
  }
  const cold = receipts.filter((receipt) => receipt.phase === 'cold');
  const warmDrift = receipts.filter((receipt) => receipt.phase !== 'cold');
  const drift = receipts.filter((receipt) => receipt.phase === 'drift');
  const coldExact = cold.filter((receipt) => receipt.exact_live_verification && receipt.harness_success);
  const paired = new Set(coldExact.map((receipt) => receipt.repetition).filter((repetition) => (
    warmDrift.filter((receipt) => receipt.repetition === repetition).length === 6
  )));
  const silent = receipts.filter((receipt) => receipt.harness_success && !receipt.exact_live_verification);
  const coldComplete = cold.filter((receipt) => receipt.provider_receipts_complete).length;
  const warmComplete = warmDrift.filter((receipt) => receipt.provider_receipts_complete).length;
  const disqualifications: string[] = [];
  if (coldExact.length < 3) disqualifications.push(`only ${coldExact.length} exact cold success in ${cold.length} attempts; 3 paired preparations required`);
  if (paired.size < 3) disqualifications.push(`only ${paired.size} complete paired repetition; 3 required`);
  if (silent.length > 0) disqualifications.push(`${silent.length} harness-declared successes failed the independent exact oracle`);
  if (coldComplete < cold.length) disqualifications.push(`raw provider receipts are incomplete for ${cold.length - coldComplete}/${cold.length} cold attempts; token and cost ranking prohibited`);

  const certificationEligible = disqualifications.length === 0;
  const summary = StagehandQualificationSummarySchema.parse({
    protocol_id: 'stagehand-v3.7.1-b2-b5-qualification-v1',
    certification_eligible: certificationEligible,
    decision: certificationEligible ? 'qualify_for_certification' : 'stop_before_certification',
    cold_attempts: cold.length,
    cold_exact_successes: coldExact.length,
    cold_harness_conclusions: cold.filter((receipt) => receipt.harness_success).length,
    cold_exact_success_rate: coldExact.length / cold.length,
    cold_exact_success_interval_95: wilsonInterval(coldExact.length, cold.length),
    complete_paired_repetitions: paired.size,
    drift_attempts: drift.length,
    drift_exact_successes: drift.filter((receipt) => receipt.exact_live_verification).length,
    observed_silent_failures: silent.length,
    cold_receipts_complete: coldComplete,
    warm_drift_receipts_complete: warmComplete,
    warm_drift_attempts: warmDrift.length,
    disqualifications,
  });
  const records = receipts.map(toCompetitorRecord);
  return { summary, records };
}

/** Writes neutral records, a machine decision, and the human-readable Stagehand stop report. */
export async function writeStagehandQualification(
  receiptsPath: string,
  recordsPath: string,
  reportPath: string,
  summaryPath: string,
): Promise<StagehandQualificationSummary> {
  const text = await readFile(receiptsPath, 'utf8');
  const receipts = text.split('\n').filter(Boolean).map((line) => StagehandQualificationReceiptSchema.parse(JSON.parse(line)));
  const { summary, records } = buildStagehandQualification(receipts);
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(reportPath, renderStagehandQualification(summary));
  return summary;
}

/** Renders qualification as a stop decision, not a comparative performance claim. */
export function renderStagehandQualification(summary: StagehandQualificationSummary): string {
  const interval = summary.cold_exact_success_interval_95;
  return `# Stagehand 3.7.1 B2/B5 feasibility\n\n**Decision: ${summary.certification_eligible ? 'QUALIFY for certification' : 'STOP before certification'}.** ${summary.certification_eligible ? 'The pinned adapter clears feasibility.' : 'The pinned adapter did not qualify a publishable comparative cell.'}\n\n| Audit | Result |\n|---|---:|\n| Cold exact success | ${summary.cold_exact_successes}/${summary.cold_attempts} (${(summary.cold_exact_success_rate * 100).toFixed(1)}%, 95% Wilson ${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)}%) |\n| Harness-declared cold success | ${summary.cold_harness_conclusions}/${summary.cold_attempts} |\n| Complete paired repetitions | ${summary.complete_paired_repetitions}/3 required |\n| Drift exact success | ${summary.drift_exact_successes}/${summary.drift_attempts} |\n| Observed harness-success / oracle-failure cases | ${summary.observed_silent_failures} |\n| Complete cold provider receipts | ${summary.cold_receipts_complete}/${summary.cold_attempts} |\n| Complete warm/drift provider receipts | ${summary.warm_drift_receipts_complete}/${summary.warm_drift_attempts} |\n\n## Disqualifications\n\n${summary.disqualifications.length > 0 ? summary.disqualifications.map((reason) => `- ${reason}`).join('\n') : '- none'}\n\nThese are feasibility findings, not certified Stagehand-vs-Rote token, cost, latency, or universal reliability claims. Failed attempts remain in the denominator.\n`;
}

function toCompetitorRecord(receipt: StagehandQualificationReceipt): CompetitorRunRecord {
  return CompetitorRunRecordSchema.parse({
    harness: 'stagehand',
    task: `B2-${receipt.phase}-${receipt.mutation}`,
    model: receipt.model,
    repetition: receipt.repetition,
    outcome: receipt.harness_success && receipt.exact_live_verification ? 'success' : 'failure',
    ...receipt.usage,
    duration_ms: Math.round(receipt.duration_ms),
    cache_adjusted: true,
    config_notes: `Stagehand 3.7.1 ${receipt.phase}; package ${receipt.package_integrity}; provider_receipts_complete=${receipt.provider_receipts_complete}`,
  });
}

function wilsonInterval(successes: number, attempts: number): [number, number] {
  if (attempts < 1) throw new Error('Wilson interval requires at least one attempt');
  const z = 1.959963984540054;
  const p = successes / attempts;
  const denominator = 1 + (z * z) / attempts;
  const center = (p + (z * z) / (2 * attempts)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / attempts) + (z * z) / (4 * attempts * attempts)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
