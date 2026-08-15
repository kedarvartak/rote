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
import { FileBrowserAgentRunRecorder, runBrowserAgent, TaggedLlmBrowserPlanner, type BrowserAgentFailureClassification, type BrowserPageSession, type BrowserPlannerClient } from '@rote/agent';
import { LaunchingCdpBrowserBackend } from '@rote/browser';
import { BrowserToolCaller, runPlaybook } from '@rote/executor';
import { createTaggedLlmClientFromEnv } from '@rote/llm';
import { FilePlaybookLibrary, matchPlaybook, type NoMatchReason } from '@rote/matcher';
import { NextActionPredictor, runsFromEvents } from '@rote/predictor';
import { consolidateSiteMemory, FileSiteMemoryStore, renderSiteBrief } from '@rote/site-memory';
import { listRuns, showRun } from './runs.js';

export interface RunBrowserTaskOptions {
  task: string;
  url: string;
  baseDir?: string;
  model?: string;
  maxSteps?: number;
  chromePath?: string;
  viewport?: { width: number; height: number };
  verifyText?: string;
  verifyUrlContains?: string;
  settleTimeoutMs?: number;
  /** Explicit candidate (bypasses the library); when absent the playbook library is consulted. */
  replayCandidatePath?: string;
  /** Task inputs for matching and replay binding (`--params`); ignored on the cold path except for the matcher. */
  params?: Record<string, unknown>;
  /**
   * Character budget for the advisory site brief on the cold path (tier-2 memory as
   * tier-0 content). Default 1200 (≈300 tokens); 0 disables. Empty memory renders nothing.
   */
  siteBriefChars?: number;
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
  fallbackReason?: 'fingerprint_mismatch' | 'replay_failed' | 'replay_error';
  fallbackDetail?: string;
  failureClassification?: BrowserAgentFailureClassification;
  /** Stale replay steps recovered by deterministic semantic target resolution. */
  replayRepairs?: number;
  /** How the playbook (if any) was chosen: an explicit candidate, or the matcher over the library. */
  selection?: BrowserTaskSelection;
  /** Cold path only: the site brief's size and how much of it the planner used (docs/03 hint utility). */
  siteBrief?: { chars: number; hinted: number; used: number };
  /** Cold path only, when earlier successful runs of the same task and environment exist: shadow-predictor agreement with the planner. */
  prediction?: { priorRuns: number; predicted: number; hits: number };
}

export type BrowserTaskSelection =
  | { source: 'candidate' }
  | { source: 'library'; matched: true; playbook: string; version: number; score: number; considered: number }
  | { source: 'library'; matched: false; reason: NoMatchReason; considered: number };

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
  let candidate: BrowserReplayCandidate | undefined;
  let taskSelection: BrowserTaskSelection | undefined;
  if (options.replayCandidatePath) {
    candidate = await loadReplayCandidate(options.replayCandidatePath);
    taskSelection = { source: 'candidate' };
  } else {
    // see docs/02 "Matcher" — the library is consulted for every run: fingerprint
    // hard gate first, then a conservative deterministic intent/param match. A miss
    // is a classified cold run, never a guess.
    const library = await new FilePlaybookLibrary(options.baseDir ?? '.rote').list();
    const match = matchPlaybook({ task: options.task, params: bindableParams(options.params), envFingerprint: fingerprint, candidates: library });
    if (match.kind === 'match') {
      candidate = { playbook_path: match.entry.playbook_path!, fingerprint_hash: match.entry.fingerprint_hash, params: match.bindings };
      taskSelection = { source: 'library', matched: true, playbook: match.entry.playbook.playbook, version: match.entry.playbook.version, score: match.score, considered: match.considered };
    } else {
      taskSelection = { source: 'library', matched: false, reason: match.reason, considered: match.considered };
    }
  }
  const selection = selectBrowserExecution(fingerprint.fingerprint_hash, candidate);
  const backend = dependencies.backend ?? new LaunchingCdpBrowserBackend({
    chromePath: options.chromePath,
    windowSize: options.viewport,
  });
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

    let replayFallback: Pick<BrowserTaskResult, 'fallbackReason' | 'fallbackDetail'> | undefined;
    if (selection.phase === 'warm' && candidate) {
      const replay = dependencies.runReplay ?? runVerifiedBrowserReplay;
      try {
        const result = await replay({ candidate, page, fingerprint, options, target });
        if (result.success) return { ...result, selection: taskSelection };
        replayFallback = { fallbackReason: 'replay_failed', fallbackDetail: result.summary };
      } catch (error) {
        replayFallback = { fallbackReason: 'replay_error', fallbackDetail: asError(error).message };
      }
      // INVARIANT: a selected cheap path may fail, but it cannot strand the task
      // (see docs/02-architecture.md "Invariants"). Cold execution navigates from the pinned initial URL before planning.
    }

    const cold = await runColdBrowserTask(options, target, page, fingerprint, dependencies.planner);
    const fingerprintFallback = 'fallbackReason' in selection
      ? { fallbackReason: selection.fallbackReason }
      : undefined;
    return { ...cold, ...(replayFallback ?? fingerprintFallback), selection: taskSelection };
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
  // Tier-2 memory as tier-0 content: a hard-budgeted, run-stable advisory brief from
  // this environment's site memory (empty memory → nothing rendered, nothing paid).
  const briefChars = options.siteBriefChars ?? DEFAULT_SITE_BRIEF_CHARS;
  const brief = briefChars > 0
    ? renderSiteBrief(consolidateSiteMemory(await new FileSiteMemoryStore(options.baseDir ?? '.rote').read(fingerprint.fingerprint_hash), { now: new Date() }), { maxChars: briefChars })
    : undefined;
  // Shadow predictor from earlier successful runs of this exact task in this
  // environment (P2 item 10): its agreement with the planner is recorded per step
  // and never dispatched — the live-page hit rate T38 could not measure offline.
  const priors = await priorRunsForTask(options.baseDir ?? '.rote', options.task, fingerprint.fingerprint_hash);
  const predictor = priors.length > 0 ? new NextActionPredictor(priors) : undefined;
  const result = await runBrowserAgent({
    task: options.task,
    page,
    planner,
    ...(brief && brief.text ? { siteBrief: { text: brief.text, hintedStableIds: brief.hintedStableIds } } : {}),
    ...(predictor ? { predictor } : {}),
    verifier: {
      async verify(captured) {
        const failures: string[] = [];
        const visibleText = [captured.title, ...captured.elements.map((element) => element.text)].join(' ');
        if (options.verifyText && !visibleText.includes(options.verifyText)) failures.push(`text "${options.verifyText}" not visible`);
        if (options.verifyUrlContains && !captured.url.includes(options.verifyUrlContains)) failures.push(`URL does not contain "${options.verifyUrlContains}"`);
        return failures.length === 0
          ? {
              success: true,
              summary: 'task verification passed',
              // The checks that decided success, so a distilled playbook can learn its `verify`.
              checks: [
                ...(options.verifyText ? [{ text_visible: options.verifyText }] : []),
                ...(options.verifyUrlContains ? [{ url_contains: options.verifyUrlContains }] : []),
              ],
            }
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
    ...(result.failureClassification ? { failureClassification: result.failureClassification } : {}),
    ...(result.siteBriefUtility ? { siteBrief: result.siteBriefUtility } : {}),
    ...(predictor && result.predictionSummary ? { prediction: { priorRuns: priors.length, ...result.predictionSummary } } : {}),
  };
}

/** Successful recorded runs with the same task text and environment fingerprint, as predictor corpus. */
async function priorRunsForTask(baseDir: string, task: string, fingerprintHash: string) {
  const summaries = await listRuns(baseDir);
  const matching = summaries.filter((entry) => entry.manifest?.outcome === 'success' && entry.manifest.task_spec === task && entry.manifest.env_fingerprint.fingerprint_hash === fingerprintHash);
  const events = (await Promise.all(matching.map((entry) => showRun(baseDir, entry.run_id)))).flatMap((detail) => detail.events);
  return runsFromEvents(events, () => 'task');
}

const DEFAULT_SITE_BRIEF_CHARS = 1200;

/** Only string/number/boolean values can bind playbook params; anything else is not a param. */
function bindableParams(params: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

async function runVerifiedBrowserReplay(input: BrowserReplayRunInput): Promise<BrowserTaskResult> {
  const playbook = parsePlaybookYaml(await readFile(input.candidate.playbook_path, 'utf8'));
  const result = await runPlaybook(playbook, {
    ...input.candidate.params,
    base_url: input.target.origin,
    initial_url: input.target.toString(),
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
    replayRepairs: result.repairedStepIds.length,
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
