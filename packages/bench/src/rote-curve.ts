import type { TokenUsage } from '@rote/core';
import { CurveStepRecordSchema, parseCurveStepJsonl, type CurveStepRecord } from './curve-protocol.js';

interface ProviderReceiptLike {
  provider: 'anthropic' | 'openai';
  model: string;
  usage: Record<string, unknown>;
}

interface RoteCurveStepLike {
  step: number;
  action: { kind: string };
  observation: {
    mode: 'full' | 'diff' | 'summary' | 'bootstrap';
    text: string;
    approxTokens: number;
  };
  usage: TokenUsage;
  providerReceipt?: ProviderReceiptLike;
  repairUsage?: readonly TokenUsage[];
  repairProviderReceipts?: readonly ProviderReceiptLike[];
  durationMs: number;
}

/** Completed Rote run input required to build provider-call curve rows. */
export interface RoteCurveRunInput {
  protocolId: string;
  taskId: string;
  provider: 'anthropic' | 'openai';
  model: string;
  runId: string;
  repetition: number;
  targetSteps: number;
  outcome: 'success' | 'failure';
  steps: readonly RoteCurveStepLike[];
}

/** Converts one Rote agent run into audited per-provider-call G1 records. */
export function roteCurveRecordsFromRun(run: RoteCurveRunInput): CurveStepRecord[] {
  const calls = run.steps.flatMap((step) => {
    const usages = [step.usage, ...(step.repairUsage ?? [])];
    const receipts = step.providerReceipt
      ? [step.providerReceipt, ...(step.repairProviderReceipts ?? [])]
      : [];
    if (receipts.length !== usages.length) {
      throw new Error(`Rote curve run ${run.runId} agent step ${step.step + 1} has ${usages.length} calls but ${receipts.length} provider receipts`);
    }
    return usages.map((usage, index) => ({ step, usage, receipt: receipts[index]! }));
  });
  if (calls.length === 0) throw new Error(`Rote curve run ${run.runId} contains no provider calls`);

  const cumulative = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 };
  const records = calls.map(({ step, usage, receipt }, index) => {
    if (receipt.provider !== run.provider || receipt.model !== run.model) {
      throw new Error(
        `Rote curve run ${run.runId} call ${index + 1} used ${receipt.provider}/${receipt.model}, expected ${run.provider}/${run.model}`,
      );
    }
    cumulative.input_tokens += usage.input_tokens;
    cumulative.cache_read_tokens += usage.cache_read_tokens;
    cumulative.cache_write_tokens += usage.cache_write_tokens;
    cumulative.output_tokens += usage.output_tokens;
    const final = index === calls.length - 1;
    return CurveStepRecordSchema.parse({
      schema_version: 1,
      record_kind: 'measurement',
      protocol_id: run.protocolId,
      task_id: run.taskId,
      harness: 'rote',
      provider: run.provider,
      model: run.model,
      run_id: run.runId,
      repetition: run.repetition,
      target_steps: run.targetSteps,
      step_index: index + 1,
      agent_step_index: step.step + 1,
      source: usage.source,
      duration_ms: step.durationMs,
      duration_scope: 'agent_step',
      usage: {
        input_tokens: usage.input_tokens,
        cache_read_tokens: usage.cache_read_tokens,
        cache_write_tokens: usage.cache_write_tokens,
        output_tokens: usage.output_tokens,
      },
      cumulative_usage: { ...cumulative },
      provider_usage: receipt.usage,
      action_kind: step.action.kind,
      observation: {
        mode: step.observation.mode,
        rendered_chars: step.observation.text.length,
        approximate_tokens: step.observation.approxTokens,
      },
      step_outcome: final ? run.outcome : 'continued',
      ...(final ? { verification_passed: run.outcome === 'success' } : {}),
    });
  });
  // Round-trip through sequence and cumulative validation before any caller writes evidence.
  return parseCurveStepJsonl(records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

/** Renders one completed Rote run as validated G1 JSONL. */
export function renderRoteCurveRun(run: RoteCurveRunInput): string {
  return roteCurveRecordsFromRun(run).map((record) => JSON.stringify(record)).join('\n') + '\n';
}
