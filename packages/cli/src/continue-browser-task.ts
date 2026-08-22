import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SettledBrowserPageSession, type SettleableBrowserPage } from '@rote/action';
import type { BrowserPageSession } from '@rote/agent';
import { LaunchingCdpBrowserBackend } from '@rote/browser';
import { createEnterpriseOracleEvidenceAdapter, EnterpriseOracleSnapshotSchema } from '@rote/bench';
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
  /**
   * Authoritative-evidence oracle URL template; `{task_id}` is replaced with the
   * evidence subject's task id. When set, every checkpoint binds the oracle's
   * events and freshness generation (E7.4), so a fixture reset or diverged state
   * refuses the resume instead of replaying over it. Without it, `rote continue`
   * writes checkpoints with no evidence refs — exactly as before.
   */
  evidenceOracleUrl?: string;
  /** Evidence subject run id (defaults to the task id); recorded in envelopes, never guessed. */
  evidenceRunId?: string;
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
export async function continueBrowserTask(options: ContinueBrowserTaskOptions, dependencies: { backend?: BrowserTaskBackend; fetchJson?: (url: string) => Promise<unknown>; clock?: () => number } = {}): Promise<ContinueBrowserTaskResult> {
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
      ...(options.evidenceOracleUrl ? { evidence: buildOracleEvidence(options, dependencies) } : {}),
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

/** Binds the E7.1/E7.4 oracle contract into continuation exactly as the bench certification does (T37). */
function buildOracleEvidence(
  options: ContinueBrowserTaskOptions,
  dependencies: { fetchJson?: (url: string) => Promise<unknown>; clock?: () => number },
) {
  const template = options.evidenceOracleUrl!;
  const fetchJson = dependencies.fetchJson ?? defaultFetchJson;
  const clock = dependencies.clock ?? Date.now;
  const urlFor = (taskId: string) => template.replaceAll('{task_id}', encodeURIComponent(taskId));
  const subject = { task_id: options.taskId, run_id: options.evidenceRunId ?? options.taskId };
  return {
    adapters: [createEnterpriseOracleEvidenceAdapter({ id: 'oracle', oracleUrl: (evidenceSubject) => urlFor(evidenceSubject.task_id), fetchJson, clock })],
    subject,
    // The oracle's generation is its freshness epoch (fixture reset, deploy);
    // stale checkpoint evidence then refuses the resume rather than replaying.
    currentGeneration: async () => EnterpriseOracleSnapshotSchema.parse(await fetchJson(urlFor(options.taskId))).generation,
  };
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`oracle request failed: ${response.status} ${url}`);
  return response.json();
}

function isSettleable(page: BrowserPageSession): page is BrowserPageSession & SettleableBrowserPage {
  return 'sampleActivity' in page && typeof page.sampleActivity === 'function';
}
