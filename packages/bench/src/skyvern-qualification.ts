import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CompetitorRunRecordSchema, type CompetitorRunRecord } from './competitor.js';

const VERIFY_TEXT = 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148';
const IMAGE_DIGEST = 'sha256:ad58d950f1c8cc3bc2d442228f701243b80b84494f11bbb066347ed034006e77';
const mutations = ['fields-renamed', 'submit-renamed', 'wrappers', 'stale-selector-decoys', 'ambiguous-company'] as const;

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_write_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
}).strict();

const ArtifactIdentitySchema = z.object({
  script_id: z.string().startsWith('s_'),
  version: z.number().int().positive(),
  sha256: z.string().length(64),
  cache_key_value: z.string().min(1),
}).strict();

/** Validates one independently graded Skyvern cold, warm, or drift attempt. */
export const SkyvernQualificationReceiptSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.literal('skyvern-v1.0.47-b2-b5-qualification-v1'),
  harness: z.literal('skyvern'),
  harness_version: z.literal('1.0.47'),
  source_commit: z.literal('9fc0b2aee079ee34ae3cdb578ca346f06c733218f'),
  image_index_digest: z.literal(IMAGE_DIGEST),
  provider: z.literal('openai'),
  model: z.literal('gpt-4.1-mini'),
  viewport: z.object({ width: z.literal(1920), height: z.literal(1080) }),
  task: z.literal('B2'),
  phase: z.enum(['cold', 'warm', 'drift']),
  mutation: z.enum(['canonical', ...mutations]),
  repetition: z.number().int().positive().max(6),
  initial_url: z.literal('http://127.0.0.1:8092/b2-vendor-form.html'),
  verify_text: z.literal(VERIFY_TEXT),
  workflow: z.record(z.string(), z.unknown()),
  run_id: z.string().startsWith('wr_'),
  status: z.string(),
  harness_success: z.boolean(),
  exact_live_verification: z.boolean(),
  outcome: z.enum(['cold_success', 'code_replay_success', 'model_assisted_replay_success', 'ai_fallback_success', 'silent_failure', 'failure']),
  ai_fallback_triggered: z.boolean(),
  script_id_used: z.string().startsWith('s_').nullable(),
  script_revision_id_used: z.string().startsWith('sr_').nullable(),
  artifact_before: ArtifactIdentitySchema.nullable(),
  artifact_after: ArtifactIdentitySchema.nullable(),
  artifact_changed: z.boolean(),
  usage: UsageSchema,
  runtime_usage: UsageSchema,
  regeneration_usage: UsageSchema,
  llm_call_aggregates: z.array(z.object({ prompt_name: z.string(), ...UsageSchema.shape }).strict()),
  raw_provider_receipts: z.array(z.unknown()),
  provider_receipts_complete: z.boolean(),
  duration_ms: z.number().nonnegative(),
  destructive_dispatches: z.array(z.unknown()),
  independent_audit: z.array(z.unknown()),
  failure_reason: z.unknown().nullable(),
  raw_directory: z.string().min(1),
}).strict();
/** One independently graded Skyvern qualification attempt. */
export type SkyvernQualificationReceipt = z.infer<typeof SkyvernQualificationReceiptSchema>;

/** Validates the fail-closed Skyvern feasibility decision. */
export const SkyvernQualificationSummarySchema = z.object({
  protocol_id: z.literal('skyvern-v1.0.47-b2-b5-qualification-v1'),
  certification_eligible: z.boolean(),
  decision: z.enum(['qualify_for_certification', 'stop_before_certification']),
  cold_attempts: z.number().int().positive(),
  cold_exact_successes: z.number().int().nonnegative(),
  cold_harness_conclusions: z.number().int().nonnegative(),
  cold_exact_success_interval_95: z.tuple([z.number(), z.number()]),
  complete_paired_repetitions: z.number().int().nonnegative(),
  warm_drift_attempts: z.number().int().nonnegative(),
  warm_drift_exact_successes: z.number().int().nonnegative(),
  generated_script_attempts: z.number().int().nonnegative(),
  ai_fallback_attempts: z.number().int().nonnegative(),
  zero_llm_replay_attempts: z.number().int().nonnegative(),
  artifact_change_attempts: z.number().int().nonnegative(),
  observed_silent_failures: z.number().int().nonnegative(),
  destructive_dispatches: z.number().int().nonnegative(),
  ambiguous_attempts: z.number().int().nonnegative(),
  ambiguous_exact_successes: z.number().int().nonnegative(),
  complete_provider_receipts: z.number().int().nonnegative(),
  total_attempts: z.number().int().positive(),
  disqualifications: z.array(z.string().min(1)),
});
/** Machine-readable Skyvern feasibility decision and audit totals. */
export type SkyvernQualificationSummary = z.infer<typeof SkyvernQualificationSummarySchema>;

/** Audits pinned Skyvern preparation/replay receipts without treating aggregate telemetry as provider receipts. */
export function buildSkyvernQualification(
  input: readonly SkyvernQualificationReceipt[],
): { summary: SkyvernQualificationSummary; records: CompetitorRunRecord[] } {
  const receipts = z.array(SkyvernQualificationReceiptSchema).min(1).parse(input);
  const identities = new Set<string>();
  for (const receipt of receipts) {
    const key = identity(receipt);
    if (identities.has(key)) throw new Error(`duplicate Skyvern receipt ${key}`);
    identities.add(key);
    if (receipt.harness_success && !receipt.exact_live_verification && receipt.outcome !== 'silent_failure') {
      throw new Error(`${key} hides failed independent verification behind ${receipt.outcome}`);
    }
    if (receipt.phase !== 'cold' && receipt.script_id_used === null) {
      throw new Error(`${key} has no generated script identity`);
    }
    for (const bucket of Object.keys(receipt.usage) as (keyof typeof receipt.usage)[]) {
      if (receipt.runtime_usage[bucket] + receipt.regeneration_usage[bucket] !== receipt.usage[bucket]) {
        throw new Error(`${key} runtime and regeneration ${bucket} do not reconcile`);
      }
    }
  }
  const cold = receipts.filter((receipt) => receipt.phase === 'cold');
  const warmDrift = receipts.filter((receipt) => receipt.phase !== 'cold');
  const coldExact = cold.filter(exactSuccess);
  const requiredCells = new Set(['warm:canonical', ...mutations.map((mutation) => `drift:${mutation}`)]);
  const paired = new Set(coldExact.map((receipt) => receipt.repetition).filter((repetition) => {
    const observed = new Set(warmDrift.filter((receipt) => receipt.repetition === repetition && exactSuccess(receipt)).map((receipt) => `${receipt.phase}:${receipt.mutation}`));
    return [...requiredCells].every((cell) => observed.has(cell));
  }));
  const silent = receipts.filter((receipt) => receipt.harness_success && !receipt.exact_live_verification);
  const completeProviderReceipts = receipts.filter((receipt) => receipt.provider_receipts_complete).length;
  const disqualifications: string[] = [];
  if (coldExact.length < 3) disqualifications.push(`only ${coldExact.length} exact cold preparations in ${cold.length} attempts; 3 required`);
  if (paired.size < 3) disqualifications.push(`only ${paired.size} complete warm/drift pairs; 3 required`);
  if (silent.length > 0) disqualifications.push(`${silent.length} harness-declared successes failed the independent exact oracle`);
  if (completeProviderReceipts < receipts.length) disqualifications.push(`raw provider receipts are incomplete for ${receipts.length - completeProviderReceipts}/${receipts.length} attempts; token and cost ranking prohibited`);
  if (warmDrift.some((receipt) => receipt.ai_fallback_triggered)) {
    disqualifications.push('aggregate runtime telemetry cannot attribute generated replay, repair, and AI-fallback usage separately');
  }

  const summary = SkyvernQualificationSummarySchema.parse({
    protocol_id: 'skyvern-v1.0.47-b2-b5-qualification-v1',
    certification_eligible: disqualifications.length === 0,
    decision: disqualifications.length === 0 ? 'qualify_for_certification' : 'stop_before_certification',
    cold_attempts: cold.length,
    cold_exact_successes: coldExact.length,
    cold_harness_conclusions: cold.filter((receipt) => receipt.harness_success).length,
    cold_exact_success_interval_95: wilsonInterval(coldExact.length, cold.length),
    complete_paired_repetitions: paired.size,
    warm_drift_attempts: warmDrift.length,
    warm_drift_exact_successes: warmDrift.filter(exactSuccess).length,
    generated_script_attempts: warmDrift.filter((receipt) => receipt.script_id_used !== null).length,
    ai_fallback_attempts: warmDrift.filter((receipt) => receipt.ai_fallback_triggered).length,
    zero_llm_replay_attempts: warmDrift.filter((receipt) => Object.values(receipt.usage).every((value) => value === 0)).length,
    artifact_change_attempts: warmDrift.filter((receipt) => receipt.artifact_changed).length,
    observed_silent_failures: silent.length,
    destructive_dispatches: receipts.reduce((sum, receipt) => sum + receipt.destructive_dispatches.length, 0),
    ambiguous_attempts: receipts.filter((receipt) => receipt.mutation === 'ambiguous-company').length,
    ambiguous_exact_successes: receipts.filter((receipt) => receipt.mutation === 'ambiguous-company' && exactSuccess(receipt)).length,
    complete_provider_receipts: completeProviderReceipts,
    total_attempts: receipts.length,
    disqualifications,
  });
  return { summary, records: receipts.map(toCompetitorRecord) };
}

/** Writes neutral records, a machine decision, and the human-readable Skyvern feasibility report. */
export async function writeSkyvernQualification(
  receiptsPath: string,
  recordsPath: string,
  reportPath: string,
  summaryPath: string,
): Promise<SkyvernQualificationSummary> {
  const text = await readFile(receiptsPath, 'utf8');
  const receipts = text.split('\n').filter(Boolean).map((line) => SkyvernQualificationReceiptSchema.parse(JSON.parse(line)));
  const { summary, records } = buildSkyvernQualification(receipts);
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(reportPath, renderSkyvernQualification(summary));
  return summary;
}

/** Renders qualification findings without publishing unsupported efficiency rankings. */
export function renderSkyvernQualification(summary: SkyvernQualificationSummary): string {
  const interval = summary.cold_exact_success_interval_95;
  return `# Skyvern 1.0.47 B2/B5 generated-code feasibility\n\n**Decision: ${summary.certification_eligible ? 'QUALIFY for certification' : 'STOP before certification'}.** ${summary.certification_eligible ? 'The pinned adapter clears feasibility.' : 'The pinned adapter does not support a publishable comparative token or cost cell.'}\n\n| Audit | Result |\n|---|---:|\n| Cold exact success | ${summary.cold_exact_successes}/${summary.cold_attempts} (95% Wilson ${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)}%) |\n| Harness-declared cold success | ${summary.cold_harness_conclusions}/${summary.cold_attempts} |\n| Complete generated-code warm/drift pairs | ${summary.complete_paired_repetitions}/3 required |\n| Warm/drift exact success | ${summary.warm_drift_exact_successes}/${summary.warm_drift_attempts} |\n| Warm/drift runs using a generated script | ${summary.generated_script_attempts}/${summary.warm_drift_attempts} |\n| Runtime AI fallback triggered | ${summary.ai_fallback_attempts}/${summary.warm_drift_attempts} |\n| Zero-LLM replay observed | ${summary.zero_llm_replay_attempts}/${summary.warm_drift_attempts} |\n| Generated artifact changed after run | ${summary.artifact_change_attempts}/${summary.warm_drift_attempts} |\n| Harness-success / oracle-failure | ${summary.observed_silent_failures} |\n| Destructive decoy dispatches | ${summary.destructive_dispatches} |\n| Ambiguous fixture exact success | ${summary.ambiguous_exact_successes}/${summary.ambiguous_attempts} |\n| Complete raw provider receipts | ${summary.complete_provider_receipts}/${summary.total_attempts} |\n\n## Disqualifications\n\n${summary.disqualifications.length > 0 ? summary.disqualifications.map((reason) => `- ${reason}`).join('\n') : '- none'}\n\nSkyvern's own per-call aggregate log telemetry is retained diagnostically, but it is not a raw provider response. Therefore these feasibility findings do not support Skyvern-vs-Rote token, cost, latency, or universal reliability claims. Rote's compared replay playbook remains hand-authored, while Skyvern generated its artifacts.\n`;
}

function exactSuccess(receipt: SkyvernQualificationReceipt): boolean {
  return receipt.harness_success && receipt.exact_live_verification;
}

function identity(receipt: SkyvernQualificationReceipt): string {
  return `${receipt.phase}:${receipt.mutation}:${receipt.repetition}`;
}

function toCompetitorRecord(receipt: SkyvernQualificationReceipt): CompetitorRunRecord {
  return CompetitorRunRecordSchema.parse({
    harness: 'skyvern',
    task: `B2-${receipt.phase}-${receipt.mutation}`,
    phase: receipt.phase,
    model: receipt.model,
    repetition: receipt.repetition,
    outcome: exactSuccess(receipt) ? 'success' : 'failure',
    ...receipt.usage,
    duration_ms: Math.round(receipt.duration_ms),
    cache_adjusted: true,
    config_notes: `Skyvern 1.0.47 generated-code ${receipt.phase}; provider_receipts_complete=${receipt.provider_receipts_complete}; aggregate telemetry only`,
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
