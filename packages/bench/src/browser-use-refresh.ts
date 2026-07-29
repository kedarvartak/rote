import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CompetitorRunRecordSchema, type CompetitorRunRecord } from './competitor.js';

const VERIFY_TEXT = 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148';
const WHEEL_SHA256 = '2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8';
const mutations = ['fields-renamed', 'submit-renamed', 'wrappers', 'stale-selector-decoys', 'ambiguous-company'] as const;

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_write_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
}).strict();

const ProviderReceiptSchema = z.object({
  model: z.literal('gpt-4.1-mini'),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    prompt_cached_tokens: z.number().int().nonnegative().nullable().optional(),
    prompt_cache_creation_tokens: z.number().int().nonnegative().nullable().optional(),
    prompt_cache_creation_5m_tokens: z.number().int().nonnegative().nullable().optional(),
    prompt_cache_creation_1h_tokens: z.number().int().nonnegative().nullable().optional(),
    completion_tokens: z.number().int().nonnegative(),
  }).passthrough(),
}).strict();

/** Validates one independently graded Browser Use 0.13.7 qualification attempt. */
export const BrowserUseRefreshReceiptSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.literal('browser-use-v0.13.7-b2-b5-qualification-v1'),
  harness: z.literal('browser-use'),
  harness_version: z.literal('0.13.7'),
  source_commit: z.literal('f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc'),
  wheel_sha256: z.literal(WHEEL_SHA256),
  provider: z.literal('openai'),
  model: z.literal('gpt-4.1-mini'),
  viewport: z.object({ width: z.literal(1920), height: z.literal(1080) }).strict(),
  task: z.literal('B2'),
  phase: z.enum(['qualification', 'b5_cold']),
  mutation: z.enum(['canonical', ...mutations]),
  repetition: z.number().int().positive().max(6),
  initial_url: z.string().startsWith('http://127.0.0.1:8093/b2-vendor-drift.html'),
  verify_text: z.literal(VERIFY_TEXT),
  harness_success: z.boolean(),
  exact_live_verification: z.boolean(),
  outcome: z.enum(['cold_success', 'silent_failure', 'failure', 'abandoned']),
  usage: UsageSchema.nullable(),
  raw_provider_receipts: z.array(ProviderReceiptSchema),
  provider_receipts_complete: z.boolean(),
  duration_ms: z.number().int().nonnegative(),
  error: z.string().nullable(),
  raw_dump: z.string().nullable(),
}).strict();
/** One independently graded Browser Use refresh attempt. */
export type BrowserUseRefreshReceipt = z.infer<typeof BrowserUseRefreshReceiptSchema>;

/** Validates the Browser Use refresh qualification decision. */
export const BrowserUseRefreshSummarySchema = z.object({
  protocol_id: z.literal('browser-use-v0.13.7-b2-b5-qualification-v1'),
  certification_eligible: z.boolean(),
  decision: z.enum(['qualify_b2_for_certification', 'stop_before_certification']),
  cold_attempts: z.number().int().positive().max(6),
  cold_exact_successes: z.number().int().nonnegative(),
  cold_harness_conclusions: z.number().int().nonnegative(),
  cold_exact_success_interval_95: z.tuple([z.number(), z.number()]),
  b5_attempts: z.number().int().nonnegative(),
  b5_exact_successes: z.number().int().nonnegative(),
  observed_silent_failures: z.number().int().nonnegative(),
  complete_provider_receipts: z.number().int().nonnegative(),
  total_attempts: z.number().int().positive(),
  disqualifications: z.array(z.string().min(1)),
});
/** Machine-readable Browser Use refresh qualification decision. */
export type BrowserUseRefreshSummary = z.infer<typeof BrowserUseRefreshSummarySchema>;

/** Audits Browser Use 0.13.7 qualification without altering historical 0.13.6 evidence. */
export function buildBrowserUseRefreshQualification(
  input: readonly BrowserUseRefreshReceipt[],
): { summary: BrowserUseRefreshSummary; records: CompetitorRunRecord[] } {
  const receipts = z.array(BrowserUseRefreshReceiptSchema).min(1).parse(input);
  const identities = new Set<string>();
  for (const receipt of receipts) {
    const key = identity(receipt);
    if (identities.has(key)) throw new Error(`duplicate Browser Use refresh receipt ${key}`);
    identities.add(key);
    if (receipt.harness_success && !receipt.exact_live_verification && receipt.outcome !== 'silent_failure') {
      throw new Error(`${key} hides failed independent verification behind ${receipt.outcome}`);
    }
    const reconciled = reconcileProviderReceipts(receipt);
    if (receipt.provider_receipts_complete !== reconciled) {
      throw new Error(`${key} provider receipt completeness does not reconcile`);
    }
  }
  const cold = receipts.filter((receipt) => receipt.phase === 'qualification');
  const b5 = receipts.filter((receipt) => receipt.phase === 'b5_cold');
  if (cold.length < 1) throw new Error('Browser Use refresh has no canonical cold attempt');
  const coldExact = cold.filter(exactSuccess);
  const silent = receipts.filter((receipt) => receipt.harness_success && !receipt.exact_live_verification);
  const completeReceipts = receipts.filter((receipt) => receipt.provider_receipts_complete).length;
  const b5Mutations = new Set(b5.map((receipt) => receipt.mutation));
  const disqualifications: string[] = [];
  if (coldExact.length < 3) disqualifications.push(`only ${coldExact.length} exact cold successes in ${cold.length} attempts; 3 required`);
  if (b5.length < mutations.length || mutations.some((mutation) => !b5Mutations.has(mutation))) {
    disqualifications.push(`only ${b5Mutations.size}/5 frozen B5 cold diagnostics are present`);
  }
  if (silent.length > 0) disqualifications.push(`${silent.length} harness-declared successes failed the independent exact oracle`);
  if (completeReceipts < receipts.length) disqualifications.push(`raw provider receipts are incomplete for ${receipts.length - completeReceipts}/${receipts.length} attempts; token and cost ranking prohibited`);

  const summary = BrowserUseRefreshSummarySchema.parse({
    protocol_id: 'browser-use-v0.13.7-b2-b5-qualification-v1',
    certification_eligible: disqualifications.length === 0,
    decision: disqualifications.length === 0 ? 'qualify_b2_for_certification' : 'stop_before_certification',
    cold_attempts: cold.length,
    cold_exact_successes: coldExact.length,
    cold_harness_conclusions: cold.filter((receipt) => receipt.harness_success).length,
    cold_exact_success_interval_95: wilsonInterval(coldExact.length, cold.length),
    b5_attempts: b5.length,
    b5_exact_successes: b5.filter(exactSuccess).length,
    observed_silent_failures: silent.length,
    complete_provider_receipts: completeReceipts,
    total_attempts: receipts.length,
    disqualifications,
  });
  return {
    summary,
    records: receipts.filter((receipt): receipt is BrowserUseRefreshReceipt & { usage: z.infer<typeof UsageSchema> } => receipt.usage !== null).map(toCompetitorRecord),
  };
}

/** Writes neutral diagnostic rows and a deterministic Browser Use refresh decision. */
export async function writeBrowserUseRefreshQualification(
  receiptsPath: string,
  recordsPath: string,
  reportPath: string,
  summaryPath: string,
): Promise<BrowserUseRefreshSummary> {
  const text = await readFile(receiptsPath, 'utf8');
  const receipts = text.split('\n').filter(Boolean).map((line) => BrowserUseRefreshReceiptSchema.parse(JSON.parse(line)));
  const { summary, records } = buildBrowserUseRefreshQualification(receipts);
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(reportPath, renderBrowserUseRefreshQualification(summary));
  return summary;
}

/** Renders qualification separately from any future ≥15-run comparative certification. */
export function renderBrowserUseRefreshQualification(summary: BrowserUseRefreshSummary): string {
  const interval = summary.cold_exact_success_interval_95;
  return `# Browser Use 0.13.7 B2/B5 refresh feasibility\n\n**Decision: ${summary.certification_eligible ? 'QUALIFY corrected B2 for a separate ≥15-run certification' : 'STOP before certification'}.** Historical Browser Use 0.13.6 G1/G2 evidence remains unchanged.\n\n| Audit | Result |\n|---|---:|\n| Corrected B2 cold exact success | ${summary.cold_exact_successes}/${summary.cold_attempts} (95% Wilson ${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)}%) |\n| Harness-declared B2 cold success | ${summary.cold_harness_conclusions}/${summary.cold_attempts} |\n| Frozen B5 cold exact success | ${summary.b5_exact_successes}/${summary.b5_attempts} |\n| Harness-success / oracle-failure | ${summary.observed_silent_failures} |\n| Complete raw provider receipts | ${summary.complete_provider_receipts}/${summary.total_attempts} |\n\n## Disqualifications\n\n${summary.disqualifications.length > 0 ? summary.disqualifications.map((reason) => `- ${reason}`).join('\n') : '- none'}\n\nThis is bounded feasibility, not a Browser Use 0.13.7-vs-Rote efficiency or universal reliability claim. B5 rows are ordinary cold re-reasoning, not replay or repair. No refreshed token, cost, or latency ranking is published until a separately frozen cell has at least 15 eligible attempts.\n`;
}

function reconcileProviderReceipts(receipt: BrowserUseRefreshReceipt): boolean {
  if (receipt.usage === null || receipt.raw_provider_receipts.length === 0) return false;
  const total = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 };
  for (const providerReceipt of receipt.raw_provider_receipts) {
    const usage = providerReceipt.usage;
    const read = usage.prompt_cached_tokens ?? 0;
    const genericWrite = usage.prompt_cache_creation_tokens ?? 0;
    const fiveMinuteWrite = usage.prompt_cache_creation_5m_tokens ?? 0;
    if ((usage.prompt_cache_creation_1h_tokens ?? 0) > 0 || (genericWrite > 0 && fiveMinuteWrite > 0)) return false;
    const write = genericWrite || fiveMinuteWrite;
    const input = usage.prompt_tokens - read - write;
    if (input < 0) return false;
    total.input_tokens += input;
    total.cache_read_tokens += read;
    total.cache_write_tokens += write;
    total.output_tokens += usage.completion_tokens;
  }
  return Object.entries(total).every(([key, value]) => receipt.usage?.[key as keyof typeof total] === value);
}

function exactSuccess(receipt: BrowserUseRefreshReceipt): boolean {
  return receipt.harness_success && receipt.exact_live_verification;
}

function identity(receipt: BrowserUseRefreshReceipt): string {
  return `${receipt.phase}:${receipt.mutation}:${receipt.repetition}`;
}

function toCompetitorRecord(receipt: BrowserUseRefreshReceipt & { usage: z.infer<typeof UsageSchema> }): CompetitorRunRecord {
  return CompetitorRunRecordSchema.parse({
    harness: 'browser-use',
    task: `B2-${receipt.phase}-${receipt.mutation}`,
    phase: 'cold',
    repetition: receipt.repetition,
    outcome: exactSuccess(receipt) ? 'success' : receipt.outcome === 'abandoned' ? 'abandoned' : 'failure',
    ...receipt.usage,
    duration_ms: receipt.duration_ms,
    model: receipt.model,
    cache_adjusted: true,
    config_notes: `Browser Use 0.13.7 cold re-reasoning; wheel_sha256=${WHEEL_SHA256}; provider_receipts_complete=true`,
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
