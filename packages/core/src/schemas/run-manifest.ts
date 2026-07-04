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

export const TokenUsageSchema = z.object({
  source: TokenUsageSourceSchema,
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

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
