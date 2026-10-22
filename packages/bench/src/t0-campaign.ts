import { TokenUsageSchema, TokenUsageSourceSchema, totalInputTokens, type TokenUsageSource } from '@rote/core';
import { z } from 'zod';
import {
  bootstrapMatchedReductionInterval,
  type BootstrapOptions,
  type ReductionInterval,
} from './competitor-gate.js';

// see docs/03-benchmark.md "T0 repeat" — no warm result may be published
// without its exact matched cold row, independent verification, complete
// provider accounting, and the deterministic stages that produced the replay.

const SourceTagsSchema = z.array(TokenUsageSourceSchema).min(1).refine(
  (sources) => new Set(sources).size === sources.length,
  'source_tags must not contain duplicates',
);

/** One retained T0 campaign attempt; failures are records, never omissions. */
export const T0CampaignRecordSchema = z.object({
  protocol_id: z.literal('p2-provider-exit-campaign-v1'),
  cell_id: z.literal('t0-distillation-repeat'),
  repetition: z.number().int().min(1).max(15),
  phase: z.enum(['cold', 'warm']),
  agent_concluded: z.boolean(),
  exact_authoritative_verification: z.boolean(),
  /** All stages reached, including deterministic zero-token distill/matcher/verify stages. */
  source_tags: SourceTagsSchema,
  /** Actual provider calls only; deterministic stages stay in source_tags rather than becoming fake zero-token calls. */
  usage: z.array(TokenUsageSchema),
  duration_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
  pricing_table: z.string().min(1),
  /** Deterministic overhead is reported separately from provider latency. */
  distill_duration_ms: z.number().nonnegative().default(0),
  matcher_duration_ms: z.number().nonnegative().default(0),
  fallback_reason: z.string().min(1).optional(),
}).strict().superRefine((record, context) => {
  for (const usage of record.usage) {
    if (!record.source_tags.includes(usage.source)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['usage'],
        message: `usage source ${usage.source} is absent from source_tags`,
      });
    }
  }
});

/** Parsed T0 collection row. */
export type T0CampaignRecord = z.infer<typeof T0CampaignRecordSchema>;

export interface T0CampaignAudit {
  repetitions: number;
  successful_pairs: number;
  cold_successes: number;
  warm_successes: number;
  success_parity: boolean;
  pricing_table: string;
  logical_input_reduction?: ReductionInterval;
  cost_reduction?: ReductionInterval;
  latency_reduction?: ReductionInterval;
  mean_distill_duration_ms: number;
  mean_matcher_duration_ms: number;
  /** Enough sound evidence exists to decide the gate. */
  certifiable: boolean;
  /** Compatibility name retained for the draft PR's first API. */
  gate_ready: boolean;
  /** The frozen T0 floor is the lower confidence bound, not the point estimate. */
  passed: boolean;
}

/**
 * Audits paired T0 rows before publication.
 *
 * @throws Error when a repetition is missing, duplicated, mixes pricing, or
 * lacks the required stage provenance. A complete collection that lost parity
 * returns `certifiable: false`; it is evidence of a failed collection, not an
 * exception that could be dropped from the denominator.
 */
export function auditT0Campaign(
  records: readonly T0CampaignRecord[],
  options: BootstrapOptions = {},
): T0CampaignAudit {
  const parsed = z.array(T0CampaignRecordSchema).parse(records);
  const pairs = new Map<number, Map<T0CampaignRecord['phase'], T0CampaignRecord>>();
  for (const row of parsed) {
    const pair = pairs.get(row.repetition) ?? new Map();
    if (pair.has(row.phase)) throw new Error(`T0 repetition ${row.repetition} has duplicate ${row.phase} row`);
    pair.set(row.phase, row);
    pairs.set(row.repetition, pair);
  }
  if (pairs.size !== 15) throw new Error(`T0 requires exactly 15 retained repetitions; found ${pairs.size}`);

  const pricingTables = new Set(parsed.map((record) => record.pricing_table));
  if (pricingTables.size !== 1) throw new Error(`T0 records span ${pricingTables.size} pricing tables`);

  const coldInput: number[] = [];
  const warmInput: number[] = [];
  const coldCost: number[] = [];
  const warmCost: number[] = [];
  const coldLatency: number[] = [];
  const warmLatency: number[] = [];
  let coldSuccesses = 0;
  let warmSuccesses = 0;
  let successfulPairs = 0;
  let distillDuration = 0;
  let matcherDuration = 0;

  for (let repetition = 1; repetition <= 15; repetition += 1) {
    const pair = pairs.get(repetition);
    const cold = pair?.get('cold');
    const warm = pair?.get('warm');
    if (!cold || !warm) throw new Error(`T0 repetition ${repetition} is not a complete cold/warm pair`);
    assertSources(cold, ['planner', 'verify']);
    assertSources(warm, ['distill', 'matcher', 'verify']);

    const coldSuccess = cold.agent_concluded && cold.exact_authoritative_verification;
    const warmSuccess = warm.agent_concluded && warm.exact_authoritative_verification;
    coldSuccesses += Number(coldSuccess);
    warmSuccesses += Number(warmSuccess);
    distillDuration += warm.distill_duration_ms;
    matcherDuration += warm.matcher_duration_ms;

    // A failed short transcript cannot count as a token, cost, or latency win.
    if (coldSuccess && warmSuccess) {
      successfulPairs += 1;
      coldInput.push(logicalInput(cold));
      warmInput.push(logicalInput(warm));
      coldCost.push(cold.cost_usd);
      warmCost.push(warm.cost_usd);
      coldLatency.push(cold.duration_ms);
      warmLatency.push(warm.duration_ms);
    }
  }

  const successParity = coldSuccesses === warmSuccesses;
  const certifiable = successfulPairs === 15 && successParity;
  const intervals = certifiable ? {
    logical_input_reduction: bootstrapMatchedReductionInterval(warmInput, coldInput, options),
    cost_reduction: bootstrapMatchedReductionInterval(warmCost, coldCost, options),
    latency_reduction: bootstrapMatchedReductionInterval(warmLatency, coldLatency, options),
  } : {};
  const passed = certifiable && intervals.logical_input_reduction!.lower >= 0.8;

  return {
    repetitions: 15,
    successful_pairs: successfulPairs,
    cold_successes: coldSuccesses,
    warm_successes: warmSuccesses,
    success_parity: successParity,
    pricing_table: [...pricingTables][0]!,
    ...intervals,
    mean_distill_duration_ms: distillDuration / 15,
    mean_matcher_duration_ms: matcherDuration / 15,
    certifiable,
    gate_ready: certifiable,
    passed,
  };
}

export function renderT0CampaignAudit(audit: T0CampaignAudit): string {
  const verdict = audit.certifiable ? (audit.passed ? 'PASS' : 'FAIL') : 'NOT CERTIFIABLE';
  const interval = (label: string, value: ReductionInterval | undefined): string => value
    ? `${label}: ${pct(value.point)} (${pct(value.lower)}–${pct(value.upper)}, ${(value.confidence * 100).toFixed(0)}% CI)`
    : `${label}: not estimated`;
  return [
    `T0 automated-distillation campaign — ${verdict}`,
    `retained pairs: ${audit.repetitions}; successful matched pairs: ${audit.successful_pairs}`,
    `success: cold ${audit.cold_successes}/${audit.repetitions}, warm ${audit.warm_successes}/${audit.repetitions}; parity ${audit.success_parity ? 'yes' : 'no'}`,
    interval('logical-input reduction', audit.logical_input_reduction),
    interval('cost reduction', audit.cost_reduction),
    interval('latency reduction', audit.latency_reduction),
    `deterministic overhead: distill mean ${audit.mean_distill_duration_ms.toFixed(1)} ms; matcher mean ${audit.mean_matcher_duration_ms.toFixed(1)} ms`,
    `pricing: ${audit.pricing_table}`,
  ].join('\n');
}

function assertSources(row: T0CampaignRecord, expected: readonly TokenUsageSource[]): void {
  for (const source of expected) {
    if (!row.source_tags.includes(source)) throw new Error(`T0 repetition ${row.repetition} ${row.phase} lacks ${source} provenance`);
  }
}

function logicalInput(row: T0CampaignRecord): number {
  return row.usage.reduce((sum, usage) => sum + totalInputTokens(usage), 0);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
