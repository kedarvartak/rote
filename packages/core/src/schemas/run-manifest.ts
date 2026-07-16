import { z } from 'zod';
import { EnvFingerprintSchema } from './env-fingerprint.js';

export const OutcomeSchema = z.enum(['success', 'failure', 'abandoned']);
export type Outcome = z.infer<typeof OutcomeSchema>;

/**
 * Every LLM call in the system must be tagged with one of these sources
 * (CLAUDE.md "every LLM call is tagged") so the benchmark harness (M3) can
 * attribute token spend to planner/matcher/slot/judgment/repair/verify/distill.
 * `judgment` was added in M2: a playbook's constrained classification steps
 * (docs/02-architecture.md "Judgment gate") are a distinct spend category
 * from `slot`'s content fills, even though both are cheap, scoped calls.
 */
export const TokenUsageSourceSchema = z.enum([
  'planner',
  'matcher',
  'slot',
  'judgment',
  'repair',
  'verify',
  'distill',
]);
export type TokenUsageSource = z.infer<typeof TokenUsageSourceSchema>;

/**
 * Provider-normalized token usage for one tagged LLM call.
 *
 * The cache fields exist because **the providers do not agree on what
 * `input_tokens` means**, and reading only that field makes the accounting
 * silently wrong the moment caching is enabled (#57):
 *
 * - **Anthropic** — `usage.input_tokens` **excludes** cache activity;
 *   `cache_read_input_tokens` and `cache_creation_input_tokens` are siblings.
 *   The true prompt size is the sum of all three.
 * - **OpenAI** — `usage.input_tokens` is the **inclusive** total, and
 *   `input_tokens_details` is a breakdown of it.
 *
 * Reading `input_tokens` from both and treating them as the same quantity means
 * turning caching on would *collapse* Anthropic's reported input — a token
 * reduction that never happened, reported by the very instrument we use to prove
 * our efficiency claims. That is invariant 1 violated inside the benchmark, so
 * these fields are normalized at the provider boundary rather than downstream.
 *
 * **Normalization contract**, enforced by `packages/llm` and its property tests:
 *
 * ```
 * input_tokens + cache_read_tokens + cache_write_tokens === the provider's true total prompt size
 * ```
 *
 * `input_tokens` is always the **uncached remainder** — billed at the model's
 * base input rate on both providers.
 */
export const TokenUsageSchema = z.object({
  source: TokenUsageSourceSchema,
  /** Uncached input, billed at the model's base input rate. Never includes cache activity. */
  input_tokens: z.number().int().nonnegative(),
  /**
   * Input served from a cache hit, billed at ~0.1x the base input rate.
   * Defaulted so manifests recorded before #57 (when no caching existed, so the
   * true value was 0) still parse.
   */
  cache_read_tokens: z.number().int().nonnegative().default(0),
  /**
   * Input written to a cache entry. Anthropic bills this at 1.25x base for the
   * 5-minute TTL and 2x for the 1-hour TTL; we only ever request the default
   * 5-minute TTL, and `packages/llm` refuses to normalize a 1-hour write rather
   * than price it as if it were cheaper (see `anthropic.ts`).
   */
  cache_write_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** Total prompt tokens the provider actually processed, cached or not. Pure. */
export function totalInputTokens(usage: TokenUsage): number {
  return usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens;
}

/**
 * Builds a `TokenUsage` for a call that did no caching, so its cache buckets are a
 * *measured* zero rather than an unknown.
 *
 * For fixtures, synthetic packs, and non-caching call sites only. **Provider
 * clients must never use this** — an unreadable usage payload is an error there
 * (`TokenAccountingError`), not a zero (#57).
 */
export function uncachedTokenUsage(
  source: TokenUsageSource,
  input_tokens: number,
  output_tokens: number,
): TokenUsage {
  return { source, input_tokens, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens };
}

/** Metadata for one full run (cold agent run or warm replay). */
export const RunManifestSchema = z
  .object({
    run_id: z.string().min(1),
    task_spec: z.string().min(1),
    env_fingerprint: EnvFingerprintSchema,
    outcome: OutcomeSchema,
    started_at: z.string().datetime(),
    ended_at: z.string().datetime().optional(),
    token_usage: z.array(TokenUsageSchema).default([]),
  })
  .refine(
    (manifest) => !manifest.ended_at || Date.parse(manifest.ended_at) >= Date.parse(manifest.started_at),
    { message: 'ended_at must not precede started_at', path: ['ended_at'] },
  );
export type RunManifest = z.infer<typeof RunManifestSchema>;
