import { z } from 'zod';
import { bootstrapMatchedReductionInterval, DEFAULT_CONFIDENCE, DEFAULT_RESAMPLES, type BootstrapOptions, type ReductionInterval } from './competitor-gate.js';

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const StableIdSchema = z.string().regex(/^v[0-9]+:[0-9a-f]{16}$/);
const SourceTagSchema = z.enum(['planner', 'site_memory', 'matcher', 'verify']);

/** One value-free paired T2 run. Task/reset/oracle digests freeze the comparison cell. */
export const T2CampaignEvidenceRowSchema = z.object({
  repetition: z.number().int().positive(),
  phase: z.enum(['brief_off', 'brief_on']),
  task_digest: DigestSchema,
  reset_digest: DigestSchema,
  oracle_digest: DigestSchema,
  pricing_table: z.string().min(1),
  success: z.boolean(),
  logical_input_tokens: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().nonnegative(),
  site_brief_chars: z.number().int().nonnegative(),
  hinted_stable_ids: z.array(StableIdSchema),
  used_stable_ids: z.array(StableIdSchema),
  matcher_duration_ms: z.number().nonnegative(),
  independent_verification: z.boolean(),
  task_is_novel: z.boolean(),
  site_memory_executed: z.boolean(),
  source_tags: z.array(SourceTagSchema).min(1),
  fallback: z.enum(['none', 'verification_failed', 'novelty_failed', 'oracle_mismatch', 'cold_fallback']).default('none'),
}).strict();
export type T2CampaignEvidenceRow = z.infer<typeof T2CampaignEvidenceRowSchema>;

export const T2CampaignReasonSchema = z.enum([
  'insufficient_matched_repetitions',
  'success_parity_lost',
  'binding_mismatch',
  'below_floor',
  'missing_source_tags',
  'novelty_not_frozen',
  'site_memory_executed',
]);
export type T2CampaignReason = z.infer<typeof T2CampaignReasonSchema>;

export interface T2CampaignReport {
  verdict: 'pass' | 'fail' | 'not_certifiable';
  minMatchedRepetitions: number;
  rows: number;
  matchedRepetitions: number;
  briefOffSuccesses: number;
  briefOnSuccesses: number;
  successParity: boolean;
  tokenInterval?: ReductionInterval;
  costInterval?: ReductionInterval;
  latencyInterval?: ReductionInterval;
  retreatTriggered: boolean;
  reasons: T2CampaignReason[];
  hintUtility: { hinted: number; used: number; usedHintCount: number; rate: number };
  hintHarm: { unhintedUsedCount: number; rate: number };
  meanMatcherDurationMs: number;
  fallbackCounts: Record<T2CampaignEvidenceRow['fallback'], number>;
}

export interface T2CampaignOptions extends BootstrapOptions {
  minMatchedRepetitions?: number;
  minReduction?: number;
  retreatBelow?: number;
}

/**
 * Audits T2 evidence while keeping every failed or mismatched row visible.
 * Only pairs with identical frozen bindings, success, and independent oracle
 * verification enter the reduction intervals.
 */
export function evaluateT2CampaignEvidence(input: readonly unknown[], options: T2CampaignOptions = {}): T2CampaignReport {
  const rows = input.map((row) => T2CampaignEvidenceRowSchema.parse(row));
  const minMatchedRepetitions = options.minMatchedRepetitions ?? 15;
  const minReduction = options.minReduction ?? 0.3;
  const retreatBelow = options.retreatBelow ?? 0.15;
  const reasons: T2CampaignReason[] = [];
  if (rows.some((row) => !row.task_is_novel)) reasons.push('novelty_not_frozen');
  if (rows.some((row) => row.site_memory_executed)) reasons.push('site_memory_executed');
  if (rows.some((row) => !requiredTags(row).every((tag) => row.source_tags.includes(tag)))) reasons.push('missing_source_tags');

  const off = rows.filter((row) => row.phase === 'brief_off');
  const on = rows.filter((row) => row.phase === 'brief_on');
  const byRepetition = new Map<number, { off?: T2CampaignEvidenceRow; on?: T2CampaignEvidenceRow }>();
  for (const row of [...off, ...on]) {
    const pair = byRepetition.get(row.repetition) ?? {};
    pair[row.phase === 'brief_off' ? 'off' : 'on'] = row;
    byRepetition.set(row.repetition, pair);
  }
  const matched = [...byRepetition.values()].filter((pair): pair is { off: T2CampaignEvidenceRow; on: T2CampaignEvidenceRow } => Boolean(pair.off && pair.on))
    .filter((pair) => sameBinding(pair.off, pair.on) && pair.off.success && pair.on.success && pair.off.independent_verification && pair.on.independent_verification);
  const briefOffSuccesses = off.filter((row) => row.success).length;
  const briefOnSuccesses = on.filter((row) => row.success).length;
  const successParity = briefOnSuccesses >= briefOffSuccesses;
  if (!successParity) reasons.push('success_parity_lost');
  if (matched.length < minMatchedRepetitions) reasons.push('insufficient_matched_repetitions');

  let tokenInterval: ReductionInterval | undefined;
  let costInterval: ReductionInterval | undefined;
  let latencyInterval: ReductionInterval | undefined;
  if (matched.length >= minMatchedRepetitions) {
    const bootstrap = (onValues: number[], offValues: number[]) => bootstrapMatchedReductionInterval(onValues, offValues, {
      confidence: options.confidence ?? DEFAULT_CONFIDENCE,
      resamples: options.resamples ?? DEFAULT_RESAMPLES,
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
    });
    tokenInterval = bootstrap(matched.map((pair) => pair.on.logical_input_tokens), matched.map((pair) => pair.off.logical_input_tokens));
    costInterval = bootstrap(matched.map((pair) => pair.on.cost_usd), matched.map((pair) => pair.off.cost_usd));
    latencyInterval = bootstrap(matched.map((pair) => pair.on.latency_ms), matched.map((pair) => pair.off.latency_ms));
    if (tokenInterval.lower < minReduction) reasons.push('below_floor');
  }

  const hintCounts = matched.reduce((counts, pair) => {
    const hinted = new Set(pair.on.hinted_stable_ids);
    const used = new Set(pair.on.used_stable_ids);
    counts.hinted += hinted.size;
    counts.used += used.size;
    counts.usedHintCount += [...used].filter((id) => hinted.has(id)).length;
    counts.unhintedUsedCount += [...used].filter((id) => !hinted.has(id)).length;
    return counts;
  }, { hinted: 0, used: 0, usedHintCount: 0, unhintedUsedCount: 0 });
  const hintUtility = { ...hintCounts, rate: hintCounts.hinted === 0 ? 0 : hintCounts.usedHintCount / hintCounts.hinted };
  const hintHarm = { unhintedUsedCount: hintCounts.unhintedUsedCount, rate: hintCounts.used === 0 ? 0 : hintCounts.unhintedUsedCount / hintCounts.used };
  const verdict = matched.length < minMatchedRepetitions
    ? 'not_certifiable'
    : reasons.length > 0
      ? 'fail'
      : 'pass';
  return {
    verdict,
    minMatchedRepetitions,
    rows: rows.length,
    matchedRepetitions: matched.length,
    briefOffSuccesses,
    briefOnSuccesses,
    successParity,
    ...(tokenInterval ? { tokenInterval } : {}),
    ...(costInterval ? { costInterval } : {}),
    ...(latencyInterval ? { latencyInterval } : {}),
    retreatTriggered: tokenInterval !== undefined && tokenInterval.lower < retreatBelow,
    reasons,
    hintUtility,
    hintHarm,
    meanMatcherDurationMs: matched.length === 0 ? 0 : matched.reduce((sum, pair) => sum + pair.on.matcher_duration_ms, 0) / matched.length,
    fallbackCounts: countFallbacks(rows),
  };
}

function requiredTags(row: T2CampaignEvidenceRow): readonly T2CampaignEvidenceRow['source_tags'][number][] {
  return row.phase === 'brief_on' ? ['planner', 'site_memory', 'matcher', 'verify'] : ['planner', 'matcher', 'verify'];
}

function sameBinding(off: T2CampaignEvidenceRow, on: T2CampaignEvidenceRow): boolean {
  return off.task_digest === on.task_digest && off.reset_digest === on.reset_digest && off.oracle_digest === on.oracle_digest && off.pricing_table === on.pricing_table;
}

function countFallbacks(rows: readonly T2CampaignEvidenceRow[]): Record<T2CampaignEvidenceRow['fallback'], number> {
  const counts: Record<T2CampaignEvidenceRow['fallback'], number> = { none: 0, verification_failed: 0, novelty_failed: 0, oracle_mismatch: 0, cold_fallback: 0 };
  for (const row of rows) counts[row.fallback] += 1;
  return counts;
}
