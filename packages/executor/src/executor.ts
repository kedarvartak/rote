import { randomUUID } from 'node:crypto';
import {
  renderTemplate,
  type EnvFingerprint,
  type Expect,
  type ParamBindings,
  type Playbook,
  type RunManifest,
  type Step,
  type TokenUsage,
} from '@rote/core';
import {
  appendTrajectoryEvent,
  buildTrajectoryEvent,
  runPaths,
  SequentialQueue,
  writeBlob,
  writeRunManifest,
} from '@rote/recorder';
import { evaluateExpect } from './expect-evaluator.js';
import type { LlmClient } from './llm-client.js';
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry-policy.js';
import type { ToolCaller } from './tool-caller.js';
import { topoOrder } from './topo-order.js';
import {
  initialWorldState,
  mergeWorldState,
  observationFromResult,
  observationFromText,
  type WorldState,
} from './world-state.js';

export type ExecutorOutcome = 'success' | 'failure' | 'fallback';

export interface ExecutorResult {
  outcome: ExecutorOutcome;
  runId: string;
  /** Every step that fully passed, in execution order — populated on every outcome, including fallback, so a caller always knows what already ran (docs/05-roadmap.md M2 "no-side-effect-repeat guard"). */
  completedStepIds: string[];
  failedStepId?: string;
  reason?: string;
  /** Attempt count per step id that was executed at least once. */
  attempts: Record<string, number>;
}

export interface ExecutorDeps {
  toolCaller: ToolCaller;
  llmClient: LlmClient;
  /** The replay's own env fingerprint, for its RunManifest — the executor doesn't probe a downstream itself (see README). */
  envFingerprint: EnvFingerprint;
  taskSpec: string;
  runId?: string;
  /** Where the replay's own trajectory/manifest are recorded (replays are runs too). Default `.rote`. */
  baseDir?: string;
  retryPolicy?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => Date;
}

/** Judgment output outside its declared enum is a hard error, never a silently-chosen branch (docs/05-roadmap.md M2). */
export class JudgmentOutOfEnumError extends Error {
  constructor(stepId: string, got: string, options: readonly string[]) {
    super(`Judgment step "${stepId}" returned "${got}", not one of [${options.join(', ')}]`);
    this.name = 'JudgmentOutOfEnumError';
  }
}

interface StepAttemptResult {
  pass: boolean;
  reason: string;
  world: WorldState;
}

function checkExpect(expect: Expect | undefined, bindings: ParamBindings, world: WorldState): { pass: boolean; reason: string } {
  if (!expect) return { pass: true, reason: 'ok' };
  const rendered = renderTemplate(expect, bindings) as Expect;
  return evaluateExpect(rendered, world);
}

/**
 * Walks a Playbook's step DAG against the real tool/LLM boundary, recording
 * its own trajectory as it goes (see docs/05-roadmap.md M2 "Executor
 * emits its own trajectory through the recorder"). Never reports 'success'
 * if any `verify` check fails, even when every step passed — sacred
 * invariant #1 (project invariant "never silently wrong"), enforced in
 * `test/invariants/never-success-on-failed-verify.test.ts`.
 */
export async function runPlaybook(
  playbook: Playbook,
  params: ParamBindings,
  deps: ExecutorDeps,
): Promise<ExecutorResult> {
  const runId = deps.runId ?? randomUUID();
  const clock = deps.clock ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryPolicy = deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const paths = runPaths(deps.baseDir ?? '.rote', runId);
  const queue = new SequentialQueue();
  const startedAt = clock().toISOString();

  let seq = 0;
  const bindings: ParamBindings = { ...params };
  const tokenUsage: TokenUsage[] = [];
  const completedStepIds: string[] = [];
  const attempts: Record<string, number> = {};
  let world = initialWorldState();

  function record(
    tool: string,
    args: Record<string, unknown>,
    outcome: { result?: unknown; error?: { message: string; code?: string } },
    duration_ms: number,
  ): void {
    const currentSeq = seq;
    seq += 1;
    const { event, blobWrite } = buildTrajectoryEvent({
      run_id: runId,
      seq: currentSeq,
      ts: clock().toISOString(),
      tool,
      args,
      result: outcome.error ? undefined : outcome.result,
      duration_ms,
      error: outcome.error,
      blobsDir: paths.blobsDir,
    });
    void queue.push(async () => {
      if (blobWrite) await writeBlob(blobWrite.path, blobWrite.contents);
      await appendTrajectoryEvent(paths.trajectoryPath, event);
    });
  }

  async function finish(outcome: ExecutorOutcome, reason?: string, failedStepId?: string): Promise<ExecutorResult> {
    await queue.drain();
    const manifest: RunManifest = {
      run_id: runId,
      task_spec: deps.taskSpec,
      env_fingerprint: deps.envFingerprint,
      outcome: outcome === 'success' ? 'success' : 'failure',
      started_at: startedAt,
      ended_at: clock().toISOString(),
      token_usage: tokenUsage,
    };
    await writeRunManifest(paths.manifestPath, manifest);
    return { outcome, runId, completedStepIds, failedStepId, reason, attempts };
  }

  async function attemptStep(step: Step): Promise<StepAttemptResult> {
    const t0 = Date.now();

    if (step.kind === 'deterministic') {
      const args = renderTemplate(step.args, bindings) as Record<string, unknown>;
      const outcome = await deps.toolCaller.call(step.tool, args);
      record(step.tool, args, outcome.ok ? { result: outcome.result } : { error: outcome.error }, Date.now() - t0);
      if (!outcome.ok) {
        return { pass: false, reason: outcome.error.message, world };
      }
      const nextWorld = mergeWorldState(world, observationFromResult(outcome.result), outcome.result);
      const checked = checkExpect(step.expect, bindings, nextWorld);
      return { ...checked, world: nextWorld };
    }

    if (step.kind === 'slot') {
      const prompt = renderTemplate(step.llm_fill.prompt, bindings) as string;
      const completion = await deps.llmClient.complete({ source: 'slot', prompt, maxTokens: step.llm_fill.max_tokens });
      tokenUsage.push({ source: 'slot', ...completion.usage });
      bindings[step.llm_fill.into] = completion.text;
      const nextWorld = mergeWorldState(world, observationFromText(completion.text), completion.text);
      const checked = checkExpect(step.expect, bindings, nextWorld);
      return { ...checked, world: nextWorld };
    }

    // judgment
    const prompt = renderTemplate(step.llm_judge.prompt, bindings) as string;
    const completion = await deps.llmClient.complete({
      source: 'judgment',
      prompt,
      options: step.llm_judge.options,
    });
    tokenUsage.push({ source: 'judgment', ...completion.usage });
    if (!step.llm_judge.options.includes(completion.text)) {
      throw new JudgmentOutOfEnumError(step.id, completion.text, step.llm_judge.options);
    }
    bindings[step.id] = completion.text;
    const nextWorld = mergeWorldState(world, observationFromText(completion.text), completion.text);
    const checked = checkExpect(step.expect, bindings, nextWorld);
    return { ...checked, world: nextWorld };
  }

  const byId = new Map(playbook.steps.map((s) => [s.id, s] as const));

  for (const stepId of topoOrder(playbook.steps)) {
    const step = byId.get(stepId);
    if (!step) continue; // unreachable for a PlaybookSchema-validated playbook
    // 'repair' isn't built yet (M6) — it downgrades to an immediate fallback
    // rather than pretending to retry or silently doing nothing.
    const maxAttempts = step.on_fail === 'retry' ? retryPolicy.maxAttempts : 1;

    let result: StepAttemptResult = { pass: false, reason: 'not attempted', world };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts[step.id] = attempt;
      result = await attemptStep(step);
      if (result.pass) break;
      if (attempt < maxAttempts) await sleep(retryPolicy.backoffMs);
    }

    world = result.world;
    if (!result.pass) {
      return finish('fallback', result.reason, step.id);
    }
    completedStepIds.push(step.id);
  }

  for (const v of playbook.verify) {
    const result = checkExpect(v, bindings, world);
    if (!result.pass) {
      return finish('failure', result.reason);
    }
  }

  return finish('success');
}
