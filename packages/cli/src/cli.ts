import { formatRunDetail, formatRunsList } from './format.js';
import { listRuns, showRun } from './runs.js';
import { runBrowserTask, type BrowserTaskResult, type RunBrowserTaskOptions } from './run-browser-task.js';

export interface CliDependencies {
  runBrowserTask: (options: RunBrowserTaskOptions) => Promise<BrowserTaskResult>;
}

const defaultDependencies: CliDependencies = { runBrowserTask };

/** Dispatches one Rote CLI command and returns its printable output. */
export async function main(
  argv: string[],
  baseDir = process.env['ROTE_BASE_DIR'] ?? '.rote',
  dependencies: CliDependencies = defaultDependencies,
): Promise<string> {
  const [group, subcommand, ...rest] = argv;
  if (group === 'runs' && subcommand === 'ls') {
    return formatRunsList(await listRuns(baseDir));
  }
  if (group === 'runs' && subcommand === 'show') {
    const runId = rest[0];
    if (!runId) throw new Error('usage: rote runs show <run_id>');
    return formatRunDetail(await showRun(baseDir, runId));
  }
  if (group === 'run') {
    if (!subcommand) throw new Error(runUsage());
    const options = parseRunOptions(subcommand, rest, baseDir);
    const result = await dependencies.runBrowserTask(options);
    if (!result.success) throw new Error(`browser task failed (run ${result.runId}): ${result.summary}`);
    return [
      `success: ${result.summary}`,
      `run: ${result.runId}`,
      `phase: ${result.phase}`,
      ...(result.fallbackReason ? [`fallback: ${result.fallbackReason}`] : []),
      `steps: ${result.steps}`,
      `tokens: ${result.inputTokens} input + ${result.outputTokens} output`,
    ].join('\n');
  }
  throw new Error(`usage: rote runs ls | rote runs show <run_id> | ${runUsage()}`);
}

function parseRunOptions(task: string, args: string[], baseDir: string): RunBrowserTaskOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(runUsage());
    values.set(flag, value);
  }
  const url = values.get('--url');
  if (!url) throw new Error(runUsage());
  const maxStepsText = values.get('--max-steps');
  const maxSteps = maxStepsText === undefined ? undefined : Number.parseInt(maxStepsText, 10);
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1)) {
    throw new Error('--max-steps must be a positive integer');
  }
  const settleTimeoutText = values.get('--settle-timeout-ms');
  const settleTimeoutMs = settleTimeoutText === undefined ? undefined : Number.parseInt(settleTimeoutText, 10);
  if (settleTimeoutMs !== undefined && (!Number.isInteger(settleTimeoutMs) || settleTimeoutMs < 1)) {
    throw new Error('--settle-timeout-ms must be a positive integer');
  }
  const knownFlags = new Set([
    '--url', '--model', '--max-steps', '--chrome-path', '--verify-text', '--verify-url-contains', '--settle-timeout-ms', '--replay-candidate',
  ]);
  for (const flag of values.keys()) if (!knownFlags.has(flag)) throw new Error(`unknown option: ${flag}`);
  if (!values.has('--verify-text') && !values.has('--verify-url-contains')) throw new Error(runUsage());
  return {
    task,
    url,
    baseDir,
    model: values.get('--model'),
    maxSteps,
    chromePath: values.get('--chrome-path'),
    verifyText: values.get('--verify-text'),
    verifyUrlContains: values.get('--verify-url-contains'),
    settleTimeoutMs,
    replayCandidatePath: values.get('--replay-candidate'),
  };
}

function runUsage(): string {
  return 'rote run <task> --url <url> (--verify-text <text> | --verify-url-contains <part>) [--model <model>] [--max-steps <n>] [--chrome-path <path>] [--settle-timeout-ms <ms>] [--replay-candidate <candidate.json>]';
}
