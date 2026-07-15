import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SettledBrowserPageSession, type SettleableBrowserPage } from '@rote/action';
import {
  BrowserReplayCandidateSchema,
  buildEnvFingerprint,
  parsePlaybookYaml,
  sha256Hex,
  type BrowserReplayCandidate,
  type EnvFingerprint,
} from '@rote/core';
import { FileBrowserAgentRunRecorder, runBrowserAgent, TaggedLlmBrowserPlanner, type BrowserPageSession, type BrowserPlannerClient } from '@rote/agent';
import { LaunchingCdpBrowserBackend } from '@rote/browser';
import { BrowserToolCaller, runPlaybook } from '@rote/executor';
import { createTaggedLlmClientFromEnv } from '@rote/llm';

export interface RunBrowserTaskOptions {
  task: string;
  url: string;
  baseDir?: string;
  model?: string;
  maxSteps?: number;
  chromePath?: string;
  verifyText?: string;
  verifyUrlContains?: string;
  settleTimeoutMs?: number;
  replayCandidatePath?: string;
  /**
   * Fixed run id for the recorded artifacts. The benchmark command driver sets
   * this (via `ROTE_RUN_ID`) so it can address the run it just produced; omitted
   * for normal use, where a random id is assigned (see #40 / docs/05 W5).
   */
  runId?: string;
}

export interface BrowserTaskResult {
  runId: string;
  success: boolean;
  summary: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  phase: 'cold' | 'warm';
  fallbackReason?: 'fingerprint_mismatch';
}

export interface BrowserTaskBackend {
  openPage(): Promise<BrowserPageSession>;
  close(): Promise<void>;
}

export interface BrowserReplayRunInput {
  candidate: BrowserReplayCandidate;
  page: BrowserPageSession;
  fingerprint: EnvFingerprint;
  options: RunBrowserTaskOptions;
  target: URL;
}

export interface RunBrowserTaskDependencies {
  backend?: BrowserTaskBackend;
  planner?: BrowserPlannerClient;
  runReplay?: (input: BrowserReplayRunInput) => Promise<BrowserTaskResult>;
}

/** Returns warm only for exact environment fingerprint equality. */
export function selectBrowserExecution(
  fingerprintHash: string,
  candidate?: BrowserReplayCandidate,
): { phase: 'warm' } | { phase: 'cold'; fallbackReason?: 'fingerprint_mismatch' } {
  if (!candidate) return { phase: 'cold' };
  // INVARIANT: environment mismatch short-circuits before any future semantic matching or replay.
  if (candidate.fingerprint_hash !== fingerprintHash) {
    return { phase: 'cold', fallbackReason: 'fingerprint_mismatch' };
  }
  return { phase: 'warm' };
}

/** Launches one recorded browser task, preferring exact-environment verified replay. */
export async function runBrowserTask(
  options: RunBrowserTaskOptions,
  dependencies: RunBrowserTaskDependencies = {},
): Promise<BrowserTaskResult> {
  const target = new URL(options.url);
  if (!options.verifyText && !options.verifyUrlContains) {
    throw new Error('browser tasks require --verify-text or --verify-url-contains for clean cold fallback');
  }
  const fingerprint = browserEnvironmentFingerprint(target);
  const candidate = options.replayCandidatePath
    ? await loadReplayCandidate(options.replayCandidatePath)
    : undefined;
  const selection = selectBrowserExecution(fingerprint.fingerprint_hash, candidate);
  const backend = dependencies.backend ?? new LaunchingCdpBrowserBackend({ chromePath: options.chromePath });
  const failureRecorder = new FileBrowserAgentRunRecorder({
    task: options.task,
    envFingerprint: fingerprint,
    baseDir: options.baseDir,
    runId: options.runId,
  });
  let rawPage: BrowserPageSession | undefined;
  try {
    try {
      rawPage = await backend.openPage();
    } catch (error) {
      const failure = asError(error);
      await failureRecorder.finish('failure', failure.message, []);
      throw failure;
    }
    const page = isSettleable(rawPage)
      ? new SettledBrowserPageSession(rawPage, { timeoutMs: options.settleTimeoutMs })
      : rawPage;

    if (selection.phase === 'warm' && candidate) {
      const replay = dependencies.runReplay ?? runVerifiedBrowserReplay;
      return await replay({ candidate, page, fingerprint, options, target });
    }

    const cold = await runColdBrowserTask(options, target, page, fingerprint, dependencies.planner);
    const fallbackReason = 'fallbackReason' in selection ? selection.fallbackReason : undefined;
    return { ...cold, ...(fallbackReason ? { fallbackReason } : {}) };
  } finally {
    const closeable = rawPage as (BrowserPageSession & { close?: () => void }) | undefined;
    closeable?.close?.();
    await backend.close();
  }
}

/** Computes the exact structural browser environment fingerprint used by replay gating. */
export function browserEnvironmentFingerprint(target: URL): EnvFingerprint {
  return buildEnvFingerprint({
    tool_inventory: browserToolInventory(),
    target_identity: target.hostname,
    surface_versions: { browser_actions: 'v1' },
  });
}

async function runColdBrowserTask(
  options: RunBrowserTaskOptions,
  target: URL,
  page: BrowserPageSession,
  fingerprint: EnvFingerprint,
  injectedPlanner?: BrowserPlannerClient,
): Promise<BrowserTaskResult> {
  const planner = injectedPlanner ?? new TaggedLlmBrowserPlanner(
    createTaggedLlmClientFromEnv({ model: options.model }),
  );
  const recorder = new FileBrowserAgentRunRecorder({ task: options.task, envFingerprint: fingerprint, baseDir: options.baseDir, runId: options.runId });
  try {
    await page.navigate(target.toString());
  } catch (error) {
    const failure = asError(error);
    await recorder.finish('failure', failure.message, []);
    throw failure;
  }
  const result = await runBrowserAgent({
    task: options.task,
    page,
    planner,
    verifier: {
      async verify(captured) {
        const failures: string[] = [];
        const visibleText = [captured.title, ...captured.elements.map((element) => element.text)].join(' ');
        if (options.verifyText && !visibleText.includes(options.verifyText)) failures.push(`text "${options.verifyText}" not visible`);
        if (options.verifyUrlContains && !captured.url.includes(options.verifyUrlContains)) failures.push(`URL does not contain "${options.verifyUrlContains}"`);
        return failures.length === 0
          ? { success: true, summary: 'task verification passed' }
          : { success: false, summary: failures.join('; ') };
      },
    },
    recorder,
    maxSteps: options.maxSteps,
  });
  return {
    runId: recorder.runId,
    success: result.success,
    summary: result.summary,
    steps: result.steps.length,
    inputTokens: result.tokenUsage.reduce((sum, usage) => sum + usage.input_tokens, 0),
    outputTokens: result.tokenUsage.reduce((sum, usage) => sum + usage.output_tokens, 0),
    phase: 'cold',
  };
}

async function runVerifiedBrowserReplay(input: BrowserReplayRunInput): Promise<BrowserTaskResult> {
  const playbook = parsePlaybookYaml(await readFile(input.candidate.playbook_path, 'utf8'));
  const result = await runPlaybook(playbook, {
    ...input.candidate.params,
    base_url: input.target.origin,
  }, {
    toolCaller: new BrowserToolCaller(input.page),
    llmClient: {
      async complete() {
        throw new Error('selected browser replay unexpectedly requested an LLM call');
      },
    },
    envFingerprint: input.fingerprint,
    taskSpec: input.options.task,
    baseDir: input.options.baseDir,
  });
  return {
    runId: result.runId,
    success: result.outcome === 'success',
    summary: result.reason ?? (result.outcome === 'success' ? 'verified browser replay passed' : `browser replay ${result.outcome}`),
    steps: result.completedStepIds.length,
    inputTokens: 0,
    outputTokens: 0,
    phase: 'warm',
  };
}

async function loadReplayCandidate(path: string): Promise<BrowserReplayCandidate> {
  const candidatePath = resolve(path);
  const candidate = BrowserReplayCandidateSchema.parse(JSON.parse(await readFile(candidatePath, 'utf8')));
  return { ...candidate, playbook_path: resolve(dirname(candidatePath), candidate.playbook_path) };
}

function isSettleable(page: BrowserPageSession): page is BrowserPageSession & SettleableBrowserPage {
  return 'sampleActivity' in page && typeof page.sampleActivity === 'function';
}

function browserToolInventory(): Array<{ name: string; schema_hash: string }> {
  return ['navigate', 'fill', 'select', 'click', 'download_file', 'extract'].map((action) => ({
    name: `browser.${action}`,
    schema_hash: sha256Hex(`rote-browser-action-v1:${action}`),
  }));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
