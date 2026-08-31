import { z } from 'zod';
import { reduction } from './stats.js';

// see docs/03-benchmark.md "T0 repeat" — no successful warm row may be
// reported without its exact matched cold row and independent verification.

const UsageSchema = z.object({ input_tokens: z.number().int().nonnegative(), cache_read_tokens: z.number().int().nonnegative(), cache_write_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).strict();
const SourceSchema = z.enum(['planner', 'matcher', 'slot', 'judgment', 'repair', 'verify', 'distill', 'route', 'predict']);

/** One retained T0 campaign attempt; failures are records, never omissions. */
export const T0CampaignRecordSchema = z.object({
  protocol_id: z.literal('p2-provider-exit-campaign-v1'),
  cell_id: z.literal('t0-distillation-repeat'),
  repetition: z.number().int().min(1).max(15),
  phase: z.enum(['cold', 'warm']),
  agent_concluded: z.boolean(),
  exact_authoritative_verification: z.boolean(),
  usage: z.array(z.object({ source: SourceSchema, tokens: UsageSchema }).strict()).min(1),
  duration_ms: z.number().nonnegative(),
  fallback_reason: z.string().min(1).optional(),
}).strict();
/** Parsed T0 collection row. */
export type T0CampaignRecord = z.infer<typeof T0CampaignRecordSchema>;

/** Fail-closed summary of one complete T0 collection. */
export interface T0CampaignAudit {
  repetitions: number;
  cold_successes: number;
  warm_successes: number;
  success_parity: boolean;
  mean_logical_token_reduction: number;
  gate_ready: boolean;
}

/**
 * Audits paired T0 rows before interval calculation or publication.
 * @throws Error when a repetition is missing, duplicated, or lacks required provenance.
 */
export function auditT0Campaign(records: readonly T0CampaignRecord[]): T0CampaignAudit {
  const parsed = z.array(T0CampaignRecordSchema).parse(records);
  const pairs = new Map<number, Map<T0CampaignRecord['phase'], T0CampaignRecord>>();
  for (const row of parsed) {
    const pair = pairs.get(row.repetition) ?? new Map();
    if (pair.has(row.phase)) throw new Error(`T0 repetition ${row.repetition} has duplicate ${row.phase} row`);
    pair.set(row.phase, row); pairs.set(row.repetition, pair);
  }
  if (pairs.size < 15) throw new Error(`T0 requires 15 matched repetitions; found ${pairs.size}`);
  const reductions: number[] = []; let coldSuccesses = 0; let warmSuccesses = 0;
  for (let repetition = 1; repetition <= 15; repetition += 1) {
    const pair = pairs.get(repetition); const cold = pair?.get('cold'); const warm = pair?.get('warm');
    if (!cold || !warm) throw new Error(`T0 repetition ${repetition} is not a complete cold/warm pair`);
    assertSources(cold, ['planner', 'verify']); assertSources(warm, ['distill', 'matcher', 'verify']);
    const coldSuccess = cold.agent_concluded && cold.exact_authoritative_verification;
    const warmSuccess = warm.agent_concluded && warm.exact_authoritative_verification;
    coldSuccesses += Number(coldSuccess); warmSuccesses += Number(warmSuccess);
    reductions.push(reduction(logicalTokens(warm), logicalTokens(cold)));
  }
  return { repetitions: 15, cold_successes: coldSuccesses, warm_successes: warmSuccesses,
    success_parity: coldSuccesses === warmSuccesses,
    mean_logical_token_reduction: reductions.reduce((sum, value) => sum + value, 0) / reductions.length,
    gate_ready: coldSuccesses === 15 && warmSuccesses === 15 };
}

function assertSources(row: T0CampaignRecord, expected: readonly z.infer<typeof SourceSchema>[]): void {
  for (const source of expected) if (!row.usage.some((entry) => entry.source === source)) throw new Error(`T0 repetition ${row.repetition} ${row.phase} lacks ${source} usage`);
}
function logicalTokens(row: T0CampaignRecord): number { return row.usage.reduce((sum, entry) => sum + entry.tokens.input_tokens + entry.tokens.cache_read_tokens + entry.tokens.cache_write_tokens + entry.tokens.output_tokens, 0); }
