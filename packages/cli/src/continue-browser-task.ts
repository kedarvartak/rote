import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SettledBrowserPageSession, type SettleableBrowserPage } from '@rote/action';
import type { BrowserPageSession } from '@rote/agent';
import { LaunchingCdpBrowserBackend } from '@rote/browser';
import { ContinuationMismatchError, continueTask, FileCheckpointStore, type ContinuationResult } from '@rote/continuation';
import { parsePlaybookYaml } from '@rote/core';
import { BrowserToolCaller, type BrowserReplayPage } from '@rote/executor';
import { browserEnvironmentFingerprint, type BrowserTaskBackend } from './run-browser-task.js';

// see docs/05-roadmap.md P2 item 9 (#133) — `rote continue` resumes (or starts) a
// controlled playbook run under a task id: append-only checkpoints after every
// step, a fixed-order resume gate before any action, and a fresh browser process
// per session. No model call; no credential handling (P4).

export interface ContinueBrowserTaskOptions {
  baseDir: string;
  taskId: string;
  playbookPath: string;
  url: string;
  params: Record<string, string | number | boolean>;
  /** Caller principal; only its digest is persisted. Default `local`. */
  principal?: string;
  /** Controlled interruption after a step id (staged rollouts, tests). */
  stopAfterStepId?: string;
  chromePath?: string;
  settleTimeoutMs?: number;
}

export interface ContinueBrowserTaskResult {
  mode: ContinuationResult['mode'];
  resumedFromSeq?: number;
  resumedStepIds: string[];
  checkpointsWritten: number;
  outcome: ContinuationResult['replay']['outcome'];
  runId: string;
  completedStepIds: string[];
  failureCode?: string;
  reason?: string;
}

/** Runs one continuation session; a resume-gate mismatch is reported as a typed error before any action. */
export async function continueBrowserTask(options: ContinueBrowserTaskOptions, dependencies: { backend?: BrowserTaskBackend } = {}): Promise<ContinueBrowserTaskResult> {
  const target = new URL(options.url);
  const playbook = parsePlaybookYaml(await readFile(resolve(options.playbookPath), 'utf8'));
  const fingerprint = browserEnvironmentFingerprint(target);
  const backend = dependencies.backend ?? new LaunchingCdpBrowserBackend({ chromePath: options.chromePath });
  let rawPage: BrowserPageSession | undefined;
  try {
    rawPage = await backend.openPage();
    const page = isSettleable(rawPage) ? new SettledBrowserPageSession(rawPage, { timeoutMs: options.settleTimeoutMs }) : rawPage;
    const result = await continueTask({
      taskId: options.taskId,
      principal: options.principal ?? 'local',
      playbook,
      params: { ...options.params, base_url: target.origin, initial_url: target.toString() },
      store: new FileCheckpointStore(options.baseDir),
      executor: {
        toolCaller: new BrowserToolCaller(page as unknown as BrowserReplayPage),
        llmClient: { async complete() { throw new Error('continuation must not call an LLM'); } },
        envFingerprint: fingerprint,
        taskSpec: playbook.task_signature.intent_description,
        baseDir: options.baseDir,
      },
      resumeUrl: target.toString(),
      // A new browser process starts blank; session setup is the caller's, not a step.
      prepareSession: async () => { await page.navigate(target.toString()); },
      ...(options.stopAfterStepId ? { stopAfterStepId: options.stopAfterStepId } : {}),
    });
    return {
      mode: result.mode,
      ...(result.resumedFromSeq !== undefined ? { resumedFromSeq: result.resumedFromSeq } : {}),
      resumedStepIds: result.resumedStepIds,
      checkpointsWritten: result.checkpointsWritten,
      outcome: result.replay.outcome,
      runId: result.replay.runId,
      completedStepIds: result.replay.completedStepIds,
      ...(result.replay.failureCode ? { failureCode: result.replay.failureCode } : {}),
      ...(result.replay.reason ? { reason: result.replay.reason } : {}),
    };
  } finally {
    const closeable = rawPage as (BrowserPageSession & { close?: () => void }) | undefined;
    closeable?.close?.();
    await backend.close();
  }
}

export { ContinuationMismatchError };

function isSettleable(page: BrowserPageSession): page is BrowserPageSession & SettleableBrowserPage {
  return 'sampleActivity' in page && typeof page.sampleActivity === 'function';
}
