import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { CurveStepRecordSchema, parseCurveStepJsonl, type CurveStepRecord } from './curve-protocol.js';

const BrowserUseProviderUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  prompt_cached_tokens: z.number().int().nonnegative().nullable().optional(),
  prompt_cache_creation_tokens: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

/** Schema for one raw Browser Use provider receipt captured during a G1 run. */
export const BrowserUseCurveRawCallSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.string().min(1),
  task_id: z.string().min(1),
  browser_use_version: z.string().min(1),
  provider: z.literal('anthropic'),
  model: z.string().min(1),
  run_id: z.string().min(1),
  repetition: z.number().int().positive(),
  target_steps: z.number().int().positive(),
  call_index: z.number().int().positive(),
  agent_step_index: z.number().int().positive(),
  agent_step_duration_ms: z.number().nonnegative(),
  provider_usage: BrowserUseProviderUsageSchema,
  action_kind: z.string().min(1).optional(),
  step_outcome: z.enum(['continued', 'success', 'failure']),
  verification_passed: z.boolean().optional(),
  agent_concluded: z.boolean().nullable().optional(),
}).superRefine((call, context) => {
  if (call.step_outcome === 'continued' && (call.verification_passed !== undefined || call.agent_concluded !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'continued calls cannot carry final grading' });
  }
  if (call.step_outcome !== 'continued' && (call.verification_passed === undefined || call.agent_concluded === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'final calls require verification and agent conclusion' });
  }
  const qualifiesAsSuccess = call.verification_passed === true && call.agent_concluded === true;
  if ((call.step_outcome === 'success') !== qualifiesAsSuccess) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'final outcome must equal agent conclusion plus independent verification' });
  }
});
/** Raw Browser Use provider call captured before repository-owned normalization. */
export type BrowserUseCurveRawCall = z.infer<typeof BrowserUseCurveRawCallSchema>;

/** Parses raw Browser Use JSONL without dropping missing, blank, or malformed receipts. */
export function parseBrowserUseCurveRawJsonl(text: string): BrowserUseCurveRawCall[] {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  const calls = lines.map((line, index) => {
    if (line.trim() === '') throw new Error(`Browser Use curve JSONL line ${index + 1} is blank`);
    return BrowserUseCurveRawCallSchema.parse(JSON.parse(line));
  });
  const previousByRun = new Map<string, BrowserUseCurveRawCall>();
  for (const call of calls) {
    const previous = previousByRun.get(call.run_id);
    const expected = (previous?.call_index ?? 0) + 1;
    if (call.call_index !== expected) {
      throw new Error(`Browser Use curve run ${call.run_id} expected provider call ${expected}, got ${call.call_index}`);
    }
    if (previous && previous.step_outcome !== 'continued') {
      throw new Error(`Browser Use curve run ${call.run_id} has a provider call after its final outcome`);
    }
    previousByRun.set(call.run_id, call);
  }
  for (const [runId, last] of previousByRun) {
    if (last.step_outcome === 'continued') throw new Error(`Browser Use curve run ${runId} has no final outcome`);
  }
  return calls;
}

/** Normalizes Browser Use's Anthropic receipts into the provider-neutral G1 buckets. */
export function browserUseCurveRecordsFromRaw(calls: readonly BrowserUseCurveRawCall[]): CurveStepRecord[] {
  const cumulativeByRun = new Map<string, { input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number }>();
  return calls.map((call) => {
    const read = call.provider_usage.prompt_cached_tokens ?? 0;
    const write = call.provider_usage.prompt_cache_creation_tokens ?? 0;
    // Browser Use 0.13.4's Anthropic adapter defines prompt_tokens as uncached
    // input plus cache reads, while exposing cache creation separately.
    const uncached = call.provider_usage.prompt_tokens - read;
    if (uncached < 0) {
      throw new Error(`Browser Use curve run ${call.run_id} call ${call.call_index} reports cache reads above prompt tokens`);
    }
    const usage = {
      input_tokens: uncached,
      cache_read_tokens: read,
      cache_write_tokens: write,
      output_tokens: call.provider_usage.completion_tokens,
    };
    const previous = cumulativeByRun.get(call.run_id) ?? {
      input_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 0,
    };
    const cumulative = {
      input_tokens: previous.input_tokens + usage.input_tokens,
      cache_read_tokens: previous.cache_read_tokens + usage.cache_read_tokens,
      cache_write_tokens: previous.cache_write_tokens + usage.cache_write_tokens,
      output_tokens: previous.output_tokens + usage.output_tokens,
    };
    cumulativeByRun.set(call.run_id, cumulative);
    return CurveStepRecordSchema.parse({
      schema_version: 1,
      record_kind: 'measurement',
      protocol_id: call.protocol_id,
      task_id: call.task_id,
      harness: 'browser-use',
      harness_version: call.browser_use_version,
      provider: call.provider,
      model: call.model,
      run_id: call.run_id,
      repetition: call.repetition,
      target_steps: call.target_steps,
      step_index: call.call_index,
      agent_step_index: call.agent_step_index,
      source: 'planner',
      duration_ms: call.agent_step_duration_ms,
      duration_scope: 'agent_step',
      usage,
      cumulative_usage: cumulative,
      provider_usage: call.provider_usage,
      ...(call.action_kind ? { action_kind: call.action_kind } : {}),
      step_outcome: call.step_outcome,
      ...(call.verification_passed === undefined ? {} : { verification_passed: call.verification_passed }),
    });
  });
}

/** Converts raw Browser Use provider receipts to validated G1 measurement JSONL. */
export async function writeBrowserUseCurveRecords(rawPath: string, outPath: string): Promise<number> {
  const calls = parseBrowserUseCurveRawJsonl(await readFile(resolve(rawPath), 'utf8'));
  if (calls.length === 0) throw new Error('Browser Use curve raw file contains no provider calls');
  const jsonl = browserUseCurveRecordsFromRaw(calls).map((record) => JSON.stringify(record)).join('\n') + '\n';
  const records = parseCurveStepJsonl(jsonl);
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), jsonl, 'utf8');
  return records.length;
}
