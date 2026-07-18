import { z } from 'zod';

const CurveCheckpointSchema = z.object({
  id: z.string().min(1),
  target_steps: z.number().int().positive(),
  selected_post_count: z.number().int().positive(),
  post_titles: z.array(z.string().min(1)).min(1),
  prompt_template: z.string().min(1),
  expected_trash_count: z.number().int().nonnegative(),
}).superRefine((checkpoint, context) => {
  if (checkpoint.post_titles.length !== checkpoint.selected_post_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'post_titles length must equal selected_post_count' });
  }
  // Login (3), checkbox clicks (k), bulk select, apply, and done make k+6
  // one-action planner calls. The protocol measures actual calls as well; this
  // target only fixes task complexity symmetrically across harnesses.
  if (checkpoint.target_steps !== checkpoint.selected_post_count + 6) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'target_steps must equal selected_post_count + 6' });
  }
  if (checkpoint.expected_trash_count !== checkpoint.selected_post_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'expected_trash_count must equal selected_post_count' });
  }
});

/** Schema for P1's real-page cumulative-token curve protocol. */
export const CurveProtocolSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  repetitions_per_harness: z.number().int().min(15),
  model_seed: z.number().int().nullable(),
  seed_policy: z.string().min(1),
  page: z.object({
    environment: z.string().min(1),
    initial_url: z.string().url(),
    reset_command: z.string().min(1),
    verify_command_template: z.string().min(1),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
  prompt_bindings: z.array(z.string().min(1)),
  checkpoints: z.array(CurveCheckpointSchema).min(2),
}).superRefine((protocol, context) => {
  const ids = new Set<string>();
  let previousSteps = 0;
  for (const [index, checkpoint] of protocol.checkpoints.entries()) {
    if (ids.has(checkpoint.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['checkpoints', index, 'id'], message: 'checkpoint ids must be unique' });
    }
    ids.add(checkpoint.id);
    if (checkpoint.target_steps <= previousSteps) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['checkpoints', index, 'target_steps'], message: 'target_steps must be strictly increasing' });
    }
    previousSteps = checkpoint.target_steps;
  }
});
export type CurveProtocol = z.infer<typeof CurveProtocolSchema>;

const TokenBucketsSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_write_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

const CurveStepCommonSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.string().min(1),
  task_id: z.string().min(1),
  harness: z.string().min(1),
  harness_version: z.string().min(1).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  run_id: z.string().min(1),
  repetition: z.number().int().positive(),
  target_steps: z.number().int().positive(),
  step_index: z.number().int().positive(),
  source: z.string().min(1),
  duration_ms: z.number().nonnegative(),
  duration_scope: z.enum(['provider_call', 'agent_step']),
  agent_step_index: z.number().int().positive().optional(),
  usage: TokenBucketsSchema,
  cumulative_usage: TokenBucketsSchema,
});

const CurveDryRunStepSchema = CurveStepCommonSchema.extend({
  record_kind: z.literal('dry_run'),
  step_outcome: z.literal('dry_run'),
  provider_usage: z.object({ dry_run: z.literal(true) }),
});

const CurveMeasurementStepSchema = CurveStepCommonSchema.extend({
  record_kind: z.literal('measurement'),
  step_outcome: z.enum(['continued', 'success', 'failure']),
  provider_usage: z.record(z.unknown()).refine((usage) => Object.keys(usage).length > 0, 'provider_usage cannot be empty'),
  action_kind: z.string().min(1).optional(),
  observation: z.object({
    mode: z.enum(['full', 'diff', 'summary', 'bootstrap']),
    rendered_chars: z.number().int().nonnegative(),
    approximate_tokens: z.number().int().nonnegative(),
  }).optional(),
  verification_passed: z.boolean().optional(),
});

/** Schema for one provider call in the G1 per-step JSONL artifact. */
export const CurveStepRecordSchema = z.discriminatedUnion('record_kind', [
  CurveDryRunStepSchema,
  CurveMeasurementStepSchema,
]).superRefine((record, context) => {
  if (record.record_kind === 'dry_run') {
    const buckets = [...Object.values(record.usage), ...Object.values(record.cumulative_usage)];
    if (buckets.some((value) => value !== 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['usage'], message: 'dry-run usage must be zero' });
    }
  }
});
export type CurveStepRecord = z.infer<typeof CurveStepRecordSchema>;

/** Parses and validates a human-authored curve protocol. */
export function parseCurveProtocol(input: unknown): CurveProtocol {
  return CurveProtocolSchema.parse(input);
}

/** Parses newline-delimited curve records without silently dropping blank or invalid rows. */
export function parseCurveStepJsonl(text: string): CurveStepRecord[] {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  const records = lines.map((line, index) => {
    if (line.trim() === '') throw new Error(`curve JSONL line ${index + 1} is blank`);
    return CurveStepRecordSchema.parse(JSON.parse(line));
  });
  assertCurveSequences(records);
  return records;
}

const TOKEN_BUCKETS = ['input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens'] as const;

function assertCurveSequences(records: readonly CurveStepRecord[]): void {
  const previousByRun = new Map<string, CurveStepRecord>();
  for (const record of records) {
    const key = `${record.harness}\u0000${record.run_id}`;
    const previous = previousByRun.get(key);
    const expectedStep = (previous?.step_index ?? 0) + 1;
    if (record.step_index !== expectedStep) {
      throw new Error(`curve run ${record.run_id} expected step ${expectedStep}, got ${record.step_index}`);
    }
    for (const bucket of TOKEN_BUCKETS) {
      const expected = (previous?.cumulative_usage[bucket] ?? 0) + record.usage[bucket];
      if (record.cumulative_usage[bucket] !== expected) {
        throw new Error(`curve run ${record.run_id} step ${record.step_index} has inconsistent cumulative ${bucket}`);
      }
    }
    previousByRun.set(key, record);
  }
}
