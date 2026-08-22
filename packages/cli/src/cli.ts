import { formatRunDetail, formatRunsList } from './format.js';
import { formatRunReport, reportRun } from './report-run.js';
import { FilePlaybookLibrary } from '@rote/matcher';
import { formatMemoryInspection, formatMemoryList, inspectMemory, listMemoryPartitions } from './memory-inspect.js';
import { listRuns, showRun } from './runs.js';
import { runBrowserTask, type BrowserTaskResult, type RunBrowserTaskOptions } from './run-browser-task.js';
import { createReplayCandidate } from './create-replay-candidate.js';
import { distillRun, type DistillRunOptions, type DistillRunResult } from './distill-run.js';
import { ContinuationMismatchError, continueBrowserTask, type ContinueBrowserTaskOptions, type ContinueBrowserTaskResult } from './continue-browser-task.js';

export interface CliDependencies {
  runBrowserTask: (options: RunBrowserTaskOptions) => Promise<BrowserTaskResult>;
  distillRun?: (options: DistillRunOptions) => Promise<DistillRunResult>;
  continueBrowserTask?: (options: ContinueBrowserTaskOptions) => Promise<ContinueBrowserTaskResult>;
}

const defaultDependencies: CliDependencies = { runBrowserTask, distillRun, continueBrowserTask };

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
  if (group === 'playbooks') {
    // The learned library is the product's memory; listing it must stay value-free —
    // names, versions, fingerprints, params, step counts, never recorded values.
    const entries = await new FilePlaybookLibrary(baseDir).list();
    if (entries.length === 0) return 'playbook library is empty — record a run, then rote distill <run_id>';
    return entries.map((entry) => {
      const params = entry.playbook.params.map((param) => param.name).join(', ') || '(none)';
      return `${entry.playbook.playbook} v${entry.playbook.version} — ${entry.playbook.steps.length} steps, params: ${params}, fingerprint ${entry.fingerprint_hash.slice(0, 12)}…${entry.source_run_id ? `, from run ${entry.source_run_id}` : ''}`;
    }).join('\n');
  }
  if (group === 'memory') {
    // Consolidation needs a "now" for freshness; the CLI edge supplies the real
    // clock, keeping the library functions pure (CLAUDE.md "inject dependencies").
    const now = new Date();
    if (!subcommand) return formatMemoryList(await listMemoryPartitions(baseDir, now));
    const briefIndex = rest.indexOf('--brief-chars');
    const briefChars = briefIndex >= 0 ? Number(rest[briefIndex + 1]) : undefined;
    if (briefChars !== undefined && (!Number.isInteger(briefChars) || briefChars <= 0)) {
      throw new Error('usage: rote memory [fingerprint_hash] [--brief-chars <n>]');
    }
    return formatMemoryInspection(await inspectMemory(baseDir, subcommand, now, briefChars));
  }
  if (group === 'report') {
    if (!subcommand) throw new Error('usage: rote report <run_id>');
    return formatRunReport(await reportRun(baseDir, subcommand));
  }
  if (group === 'candidate' && subcommand === 'create') {
    const playbookPath = rest[0];
    if (!playbookPath) throw new Error(candidateUsage());
    const options = parseCandidateOptions(rest.slice(1));
    const created = await createReplayCandidate({ playbookPath, ...options });
    return `wrote ${created.path}\nfingerprint: ${created.candidate.fingerprint_hash}`;
  }
  if (group === 'distill') {
    if (!subcommand) throw new Error(distillUsage());
    const options = parseDistillOptions(subcommand, rest, baseDir);
    const result = await (dependencies.distillRun ?? distillRun)(options);
    return [
      `wrote ${result.playbookPath}`,
      `playbook: ${result.playbook} v${result.version} (fingerprint ${result.fingerprintHash})`,
      `steps: ${result.kept} kept, ${result.pruned.length} pruned${result.pruned.length ? ` (${result.pruned.map((entry) => `${entry.seq}:${entry.reason}`).join(', ')})` : ''}`,
      `contracts: ${result.contractedSteps} steps gated`,
      `verify: ${result.verifySource}${result.evidenceClasses.length ? ` (evidence classes: ${result.evidenceClasses.join(', ')} — replay under the same policy)` : ''}`,
      `params: ${result.usedParams.length ? result.usedParams.join(', ') : '(none)'}`,
      `site memory: ${result.siteMemoryRecords} records appended, ${result.siteMemorySkipped} events skipped`,
    ].join('\n');
  }
  if (group === 'continue') {
    if (!subcommand) throw new Error(continueUsage());
    const options = parseContinueOptions(subcommand, rest, baseDir);
    let result: ContinueBrowserTaskResult;
    try {
      result = await (dependencies.continueBrowserTask ?? continueBrowserTask)(options);
    } catch (error) {
      if (error instanceof ContinuationMismatchError) throw new Error(`continuation refused before any action [${error.classification}: ${error.kind}]: ${error.message}`);
      throw error;
    }
    const lines = [
      `mode: ${result.mode}${result.resumedFromSeq !== undefined ? ` (from checkpoint ${result.resumedFromSeq})` : ''}`,
      `resumed steps: ${result.resumedStepIds.length ? result.resumedStepIds.join(', ') : '(none)'}`,
      `checkpoints written: ${result.checkpointsWritten}`,
      `outcome: ${result.outcome}${result.failureCode ? ` [${result.failureCode}]` : ''}${result.reason ? ` — ${result.reason}` : ''}`,
      `run: ${result.runId}`,
      `completed steps: ${result.completedStepIds.length}`,
    ];
    if (result.outcome === 'failure' || result.outcome === 'fallback') throw new Error(lines.join('\n'));
    return lines.join('\n');
  }
  if (group === 'run') {
    if (!subcommand) throw new Error(runUsage());
    const options = parseRunOptions(subcommand, rest, baseDir);
    // The benchmark command driver pins the run id so it can address the run it
    // just produced (docs/05 W5 repetition runner); normal use assigns a random id.
    const runId = process.env['ROTE_RUN_ID'];
    const result = await dependencies.runBrowserTask(runId ? { ...options, runId } : options);
    const fallback = formatFallback(result);
    if (!result.success) {
      const classification = result.failureClassification ? ` [${result.failureClassification}]` : '';
      throw new Error(`browser task failed${classification} (run ${result.runId}): ${result.summary}${fallback ? `; ${fallback}` : ''}`);
    }
    return [
      `success: ${result.summary}`,
      `run: ${result.runId}`,
      `phase: ${result.phase}`,
      ...(result.selection ? [formatSelection(result.selection)] : []),
      ...(result.replayRepairs !== undefined ? [`replay repairs: ${result.replayRepairs}`] : []),
      ...(fallback ? [fallback] : []),
      ...(result.siteBrief ? [`site brief: ${result.siteBrief.chars} chars, ${result.siteBrief.used}/${result.siteBrief.hinted} hints used`] : []),
      ...(result.prediction ? [`shadow predictor: ${result.prediction.hits}/${result.prediction.predicted} steps agreed (${result.prediction.priorRuns} prior runs)`] : []),
      ...(result.routing ? [`routing: ${result.routing.routine} routine / ${result.routing.frontier} frontier steps, ${result.routing.escalations} escalations`] : []),
      `steps: ${result.steps}`,
      `tokens: ${result.inputTokens} input + ${result.outputTokens} output`,
    ].join('\n');
  }
  throw new Error(`usage: rote runs ls | rote runs show <run_id> | rote report <run_id> | rote playbooks | rote memory [fingerprint_hash] [--brief-chars <n>] | ${runUsage()} | ${candidateUsage()} | ${distillUsage()} | ${continueUsage()}`);
}

function formatSelection(selection: NonNullable<BrowserTaskResult['selection']>): string {
  if (selection.source === 'candidate') return 'selection: explicit candidate';
  if (selection.matched) return `selection: library match ${selection.playbook} v${selection.version} (score ${selection.score.toFixed(2)}, ${selection.considered} considered)`;
  return `selection: no library match (${selection.reason}, ${selection.considered} considered)`;
}

function formatFallback(result: BrowserTaskResult): string | undefined {
  if (!result.fallbackReason) return undefined;
  return `fallback: ${result.fallbackReason}${result.fallbackDetail ? ` (${result.fallbackDetail})` : ''}`;
}

function parseCandidateOptions(args: string[]): { url: string; params: Record<string, unknown>; outPath: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(candidateUsage());
    values.set(flag, value);
  }
  for (const flag of values.keys()) {
    if (!['--url', '--params', '--out'].includes(flag)) throw new Error(`unknown option: ${flag}`);
  }
  const url = values.get('--url');
  const paramsText = values.get('--params');
  const outPath = values.get('--out');
  if (!url || !paramsText || !outPath) throw new Error(candidateUsage());
  let params: unknown;
  try {
    params = JSON.parse(paramsText);
  } catch {
    throw new Error('--params must be a JSON object');
  }
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('--params must be a JSON object');
  }
  return { url, params: params as Record<string, unknown>, outPath };
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
  const viewportWidth = positiveIntegerOption(values, '--viewport-width');
  const viewportHeight = positiveIntegerOption(values, '--viewport-height');
  if ((viewportWidth === undefined) !== (viewportHeight === undefined)) {
    throw new Error('--viewport-width and --viewport-height must be provided together');
  }
  const knownFlags = new Set([
    '--url', '--model', '--max-steps', '--chrome-path', '--verify-text', '--verify-url-contains', '--settle-timeout-ms', '--replay-candidate', '--viewport-width', '--viewport-height', '--params', '--site-brief-chars', '--routine-model', '--route-min-confidence',
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
    viewport: viewportWidth !== undefined && viewportHeight !== undefined
      ? { width: viewportWidth, height: viewportHeight }
      : undefined,
    verifyText: values.get('--verify-text'),
    verifyUrlContains: values.get('--verify-url-contains'),
    settleTimeoutMs,
    replayCandidatePath: values.get('--replay-candidate'),
    ...(values.has('--params') ? { params: parseJsonObject(values.get('--params')!, '--params') } : {}),
    ...(values.has('--site-brief-chars') ? { siteBriefChars: nonNegativeIntegerOption(values, '--site-brief-chars') } : {}),
    ...(values.has('--routine-model') ? { routineModel: values.get('--routine-model')! } : {}),
    ...(values.has('--route-min-confidence') ? { routeMinConfidence: unitIntervalOption(values, '--route-min-confidence') } : {}),
  };
}

function unitIntervalOption(values: ReadonlyMap<string, string>, flag: string): number {
  const value = Number.parseFloat(values.get(flag) ?? '');
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${flag} must be a number between 0 and 1`);
  return value;
}

function parseDistillOptions(runId: string, args: string[], baseDir: string): DistillRunOptions {
  const values = pairs(args, distillUsage());
  for (const flag of values.keys()) if (!['--name', '--params', '--domain', '--literal-values'].includes(flag)) throw new Error(`unknown option: ${flag}`);
  const playbookName = values.get('--name');
  if (!playbookName) throw new Error(distillUsage());
  const params = values.has('--params') ? parseJsonObject(values.get('--params')!, '--params') : {};
  for (const [name, value] of Object.entries(params)) if (typeof value !== 'string' || value.length === 0) throw new Error(`--params value for ${name} must be a non-empty string`);
  const literal = values.get('--literal-values');
  if (literal !== undefined && literal !== 'fail' && literal !== 'allow') throw new Error('--literal-values must be fail or allow');
  return {
    baseDir, runId, playbookName, params: params as Record<string, string>,
    ...(values.has('--domain') ? { domain: values.get('--domain')! } : {}),
    ...(literal ? { literalValues: literal } : {}),
  };
}

function parseContinueOptions(taskId: string, args: string[], baseDir: string): ContinueBrowserTaskOptions {
  const values = pairs(args, continueUsage());
  for (const flag of values.keys()) if (!['--playbook', '--url', '--params', '--principal', '--stop-after', '--chrome-path', '--settle-timeout-ms'].includes(flag)) throw new Error(`unknown option: ${flag}`);
  const playbookPath = values.get('--playbook');
  const url = values.get('--url');
  if (!playbookPath || !url) throw new Error(continueUsage());
  const raw = values.has('--params') ? parseJsonObject(values.get('--params')!, '--params') : {};
  const params: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error(`--params value for ${name} must be a string, number, or boolean`);
    params[name] = value;
  }
  return {
    baseDir, taskId, playbookPath, url, params,
    ...(values.has('--principal') ? { principal: values.get('--principal')! } : {}),
    ...(values.has('--stop-after') ? { stopAfterStepId: values.get('--stop-after')! } : {}),
    ...(values.has('--chrome-path') ? { chromePath: values.get('--chrome-path')! } : {}),
    ...(values.has('--settle-timeout-ms') ? { settleTimeoutMs: positiveIntegerOption(values, '--settle-timeout-ms') } : {}),
  };
}

function pairs(args: string[], usage: string): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(usage);
    values.set(flag, value);
  }
  return values;
}

function parseJsonObject(text: string, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${flag} must be a JSON object`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${flag} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function nonNegativeIntegerOption(values: ReadonlyMap<string, string>, flag: string): number {
  const value = Number.parseInt(values.get(flag) ?? '', 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} must be a non-negative integer`);
  return value;
}

function distillUsage(): string {
  return 'rote distill <run_id> --name <playbook> [--params <json-object of name→value>] [--domain <domain>] [--literal-values fail|allow]';
}

function continueUsage(): string {
  return 'rote continue <task_id> --playbook <playbook.yaml> --url <url> [--params <json-object>] [--principal <id>] [--stop-after <step_id>] [--chrome-path <path>] [--settle-timeout-ms <ms>]';
}

function positiveIntegerOption(values: ReadonlyMap<string, string>, flag: string): number | undefined {
  const text = values.get(flag);
  if (text === undefined) return undefined;
  const value = Number.parseInt(text, 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
}

function candidateUsage(): string {
  return 'rote candidate create <playbook.yaml> --url <url> --params <json-object> --out <candidate.json>';
}

function runUsage(): string {
  return 'rote run <task> --url <url> (--verify-text <text> | --verify-url-contains <part>) [--params <json-object>] [--model <model>] [--max-steps <n>] [--chrome-path <path>] [--settle-timeout-ms <ms>] [--viewport-width <px> --viewport-height <px>] [--replay-candidate <candidate.json>] [--site-brief-chars <n>] [--routine-model <model> [--route-min-confidence <0-1>]]';
}
