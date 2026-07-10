import { SettledBrowserPageSession, type SettleableBrowserPage } from '@rote/action';
import { sha256Hex, buildEnvFingerprint } from '@rote/core';
import { FileBrowserAgentRunRecorder, runBrowserAgent, TaggedLlmBrowserPlanner, type BrowserPageSession, type BrowserPlannerClient } from '@rote/agent';
import { LaunchingCdpBrowserBackend } from '@rote/browser';
import { AnthropicTaggedLlmClient } from '@rote/llm';

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
}

export interface BrowserTaskResult {
  runId: string;
  success: boolean;
  summary: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
}

export interface BrowserTaskBackend {
  openPage(): Promise<BrowserPageSession>;
  close(): Promise<void>;
}

export interface RunBrowserTaskDependencies {
  backend?: BrowserTaskBackend;
  planner?: BrowserPlannerClient;
}

/** Launches one recorded cold browser-agent task against a starting URL. */
export async function runBrowserTask(
  options: RunBrowserTaskOptions,
  dependencies: RunBrowserTaskDependencies = {},
): Promise<BrowserTaskResult> {
  const target = new URL(options.url);
  if (!options.verifyText && !options.verifyUrlContains) {
    throw new Error('browser tasks require --verify-text or --verify-url-contains');
  }
  if ((dependencies.backend && !dependencies.planner) || (!dependencies.backend && dependencies.planner)) {
    throw new Error('runBrowserTask test dependencies must provide both backend and planner');
  }
  const backend = dependencies.backend ?? new LaunchingCdpBrowserBackend({ chromePath: options.chromePath });
  const planner = dependencies.planner ?? new TaggedLlmBrowserPlanner(
    new AnthropicTaggedLlmClient({ model: options.model }),
  );
  const fingerprint = buildEnvFingerprint({
    tool_inventory: browserToolInventory(),
    target_identity: target.hostname,
    surface_versions: { browser_actions: 'v1' },
  });
  const recorder = new FileBrowserAgentRunRecorder({
    task: options.task,
    envFingerprint: fingerprint,
    baseDir: options.baseDir,
  });
  let rawPage: BrowserPageSession | undefined;
  try {
    try {
      rawPage = await backend.openPage();
    } catch (error) {
      const failure = asError(error);
      await recorder.finish('failure', failure.message, []);
      throw failure;
    }
    const page = isSettleable(rawPage)
      ? new SettledBrowserPageSession(rawPage, { timeoutMs: options.settleTimeoutMs })
      : rawPage;
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
          if (options.verifyText && !visibleText.includes(options.verifyText)) {
            failures.push(`text "${options.verifyText}" not visible`);
          }
          if (options.verifyUrlContains && !captured.url.includes(options.verifyUrlContains)) {
            failures.push(`URL does not contain "${options.verifyUrlContains}"`);
          }
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
    };
  } finally {
    const closeable = rawPage as (BrowserPageSession & { close?: () => void }) | undefined;
    closeable?.close?.();
    await backend.close();
  }
}

function isSettleable(page: BrowserPageSession): page is BrowserPageSession & SettleableBrowserPage {
  return 'sampleActivity' in page && typeof page.sampleActivity === 'function';
}

function browserToolInventory(): Array<{ name: string; schema_hash: string }> {
  return ['navigate', 'fill', 'select', 'click'].map((action) => ({
    name: `browser.${action}`,
    schema_hash: sha256Hex(`rote-browser-action-v1:${action}`),
  }));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
