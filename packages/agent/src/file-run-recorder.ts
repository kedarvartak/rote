import { randomUUID } from 'node:crypto';
import type { EnvFingerprint, Outcome, TokenUsage } from '@rote/core';
import { appendTrajectoryEvent, buildTrajectoryEvent, runPaths, writeBlob, writeRunManifest } from '@rote/recorder';
import type { BrowserAgentRunRecorder, BrowserAgentStep } from './types.js';

/** Configuration for one filesystem-backed browser-agent run recording. */
export interface FileBrowserAgentRunRecorderOptions {
  task: string;
  envFingerprint: EnvFingerprint;
  baseDir?: string;
  runId?: string;
  clock?: () => Date;
}

/** Writes browser-agent decisions/actions as a trajectory plus benchmark-compatible manifest. */
export class FileBrowserAgentRunRecorder implements BrowserAgentRunRecorder {
  readonly runId: string;
  private readonly paths;
  private readonly startedAt: string;
  private readonly clock: () => Date;
  private seq = 0;
  private finished = false;

  constructor(private readonly options: FileBrowserAgentRunRecorderOptions) {
    this.runId = options.runId ?? randomUUID();
    this.paths = runPaths(options.baseDir ?? '.rote', this.runId);
    this.clock = options.clock ?? (() => new Date());
    this.startedAt = this.clock().toISOString();
  }

  async recordStep(step: BrowserAgentStep): Promise<void> {
    if (this.finished) throw new Error(`agent run ${this.runId} is already finished`);
    const built = buildTrajectoryEvent({
      run_id: this.runId,
      seq: this.seq,
      ts: this.clock().toISOString(),
      tool: `browser.${step.action.kind}`,
      args: { ...step.action },
      result: {
        observation_tokens: step.observation.approxTokens,
        observation_mode: step.observation.mode,
        observation_bootstrap: step.observation.bootstrap,
        planner_usage: step.repairUsage ? [step.usage, ...step.repairUsage] : step.usage,
        provider_receipts: step.providerReceipt
          ? [step.providerReceipt, ...(step.repairProviderReceipts ?? [])]
          : undefined,
        action_classifications: step.classifications,
        resolution: step.resolution,
      },
      duration_ms: step.durationMs,
      error: step.error ? { message: step.error } : undefined,
      blobsDir: this.paths.blobsDir,
    });
    if (built.blobWrite) await writeBlob(built.blobWrite.path, built.blobWrite.contents);
    await appendTrajectoryEvent(this.paths.trajectoryPath, built.event);
    this.seq += 1;
  }

  async finish(outcome: Exclude<Outcome, 'abandoned'>, _summary: string, tokenUsage: readonly TokenUsage[]): Promise<void> {
    if (this.finished) throw new Error(`agent run ${this.runId} is already finished`);
    this.finished = true;
    await writeRunManifest(this.paths.manifestPath, {
      run_id: this.runId,
      task_spec: this.options.task,
      env_fingerprint: this.options.envFingerprint,
      outcome,
      started_at: this.startedAt,
      ended_at: this.clock().toISOString(),
      token_usage: [...tokenUsage],
    });
  }
}
