import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildBenchReport } from './accounting.js';
import { runCommandBenchmarkPlan } from './command-driver.js';
import { evaluateM3Gate, M3GateFailedError, renderM3GateResult } from './gate.js';
import { renderMarkdownReport } from './report.js';
import { exportSuccessfulTrajectories } from './run-store.js';
import { cellsFromSpec, parseBenchmarkSpec } from './spec.js';
import { writeSyntheticBenchmarkPack } from './synthetic.js';
import { renderSerializerComparison, SerializerParityGateError } from './serializer-comparison.js';
import { compareSerializersFromSpec } from './serializer-spec.js';
import { buildHeadToHead, readCompetitorRecords, renderHeadToHeadReport } from './competitor.js';
import { evaluateLaunchGate, LaunchGateFailedError, renderLaunchGateResult } from './competitor-gate.js';
import { readPriceTable } from './pricing.js';
import { assembleHeadToHeadRecords, competitorRecordsFromRaw, readCompetitorRawRuns } from './headhead-assembler.js';
import { writeCurveDryRun } from './curve-dry-run.js';
import { writeBrowserUseCurveRecords } from './browser-use-curve.js';
import { writeCurveCachePreflight } from './curve-cache-preflight.js';
import { writeCurveReport } from './curve-report.js';
import { writeCurveCacheEconomics } from './curve-cache-economics.js';
import { writeG2Report } from './g2-report.js';

interface ReportOptions {
  out?: string;
  exportJsonl?: string;
  minTokenReductionRatio?: number;
  minRuns?: number;
  subject?: string;
  prices?: string;
}

/** CLI entrypoint for M3 report generation from recorded run artifacts. */
export async function main(argv: string[]): Promise<string> {
  const [command, subject, ...rest] = argv;
  if (command === 'synthetic') {
    if (!subject) throw new Error(usage());
    const pack = await writeSyntheticBenchmarkPack({ outDir: subject });
    return `wrote synthetic benchmark pack: ${pack.specPath} and ${pack.reportPath}`;
  }
  if (command === 'run') {
    if (!subject) throw new Error(usage());
    const options = parseOptions(rest);
    const outDir = options.out ?? 'bench-out';
    const result = await runCommandBenchmarkPlan({ planPath: subject, outDir });
    return `wrote ${result.specPath}`;
  }
  if (command === 'curve-dry-run' || command === 'curve-browser-use-records') {
    if (!subject) throw new Error(usage());
    const options = parseOptions(rest);
    if (!options.out) throw new Error(`${command} requires --out <records.jsonl>`);
    const count = command === 'curve-dry-run'
      ? await writeCurveDryRun(subject, options.out)
      : await writeBrowserUseCurveRecords(subject, options.out);
    const label = command === 'curve-dry-run' ? 'dry-run step' : 'Browser Use measurement';
    return `wrote ${options.out} (${count} ${label} records)`;
  }
  if (command === 'curve-cache-preflight' && subject) {
    const options = parseCurvePreflightOptions(rest);
    const result = await writeCurveCachePreflight(subject, options.out, options.threshold);
    return `wrote ${options.out} (${result.cache_hit_calls}/${result.measurement_calls} calls hit cache; ${result.decision})`;
  }
  if (command === 'g2-report' && subject) {
    const options = parseG2ReportOptions(rest);
    const result = await writeG2Report(subject, options.roteManifests, options.browserDumps, {
      markdown: options.out,
      summary: options.summary,
    }, options.minRuns);
    return `wrote ${options.out} and ${options.summary} (G2 ${result.gate_passed ? 'PASS' : 'FAIL'})`;
  }
  if (command === 'curve-cache-report' && subject) {
    const options = parseCurveCacheReportOptions(rest);
    const result = await writeCurveCacheEconomics(subject, options.after, options.baseline, {
      markdown: options.out, svg: options.svg, summary: options.summary,
    }, { subjectProtocolSuffix: options.subjectProtocolSuffix });
    const longest = result.cells.at(-1)!;
    return `wrote ${options.out}, ${options.svg}, and ${options.summary} (long-cell cost reduction ${(longest.after_vs_before_cost_reduction.point * 100).toFixed(1)}%)`;
  }
  if (command === 'curve-report' && subject) {
    const options = parseCurveReportOptions(rest);
    const result = await writeCurveReport(subject, options.baseline, {
      markdown: options.out,
      svg: options.svg,
      summary: options.summary,
    }, {
      slopeReductionFloor: options.slopeFloor,
      ...(options.subjectProtocolSuffix ? { subjectProtocolSuffix: options.subjectProtocolSuffix } : {}),
    });
    return `wrote ${options.out}, ${options.svg}, and ${options.summary} (slope reduction ${(result.slope.reduction.point * 100).toFixed(1)}%; ${result.slope.passed ? 'PASS' : 'FAIL'})`;
  }
  if ((command === 'serializer-report' || command === 'serializer-gate') && subject) {
    const options = parseSerializerOptions(rest);
    const result = await compareSerializersFromSpec(subject);
    const markdown = renderSerializerComparison(result);
    if (options.out) {
      await mkdir(dirname(options.out), { recursive: true });
      await writeFile(options.out, markdown, 'utf8');
    }
    if (command === 'serializer-gate' && !result.passed) throw new SerializerParityGateError(result);
    return options.out ? `wrote ${options.out}` : markdown;
  }
  if (command === 'competitor-records' && subject) {
    const options = parseCompetitorRecordsOptions(rest);
    const records = competitorRecordsFromRaw(await readCompetitorRawRuns(subject), {
      harness: options.harness,
      model: options.model,
      cache_adjusted: options.cacheAdjusted,
      ...(options.configNotes ? { config_notes: options.configNotes } : {}),
    });
    const json = `${JSON.stringify(records, null, 2)}\n`;
    if (options.out) {
      await mkdir(dirname(options.out), { recursive: true });
      await writeFile(options.out, json, 'utf8');
      return `wrote ${options.out} (${records.length} ${options.harness} records)`;
    }
    return json;
  }
  if (command === 'records' && subject) {
    const options = parseOptions(rest);
    const records = await assembleHeadToHeadRecords(resolve(subject));
    const json = `${JSON.stringify(records, null, 2)}\n`;
    if (options.out) {
      await mkdir(dirname(options.out), { recursive: true });
      await writeFile(options.out, json, 'utf8');
      return `wrote ${options.out} (${records.length} records)`;
    }
    return json;
  }
  if ((command === 'headhead' || command === 'launch-gate') && subject) {
    const options = parseOptions(rest);
    const records = await readCompetitorRecords(resolve(subject));
    const result = buildHeadToHead(records, {
      subject: options.subject,
      ...(options.prices ? { prices: await readPriceTable(options.prices) } : {}),
    });
    if (command === 'launch-gate') {
      const gate = evaluateLaunchGate(result, {
        minTokenReductionRatio: options.minTokenReductionRatio,
        minRuns: options.minRuns,
      });
      if (!gate.passed) throw new LaunchGateFailedError(gate);
      return renderLaunchGateResult(gate);
    }
    const markdown = renderHeadToHeadReport(result);
    if (options.out) {
      await mkdir(dirname(options.out), { recursive: true });
      await writeFile(options.out, markdown, 'utf8');
      return `wrote ${options.out}`;
    }
    return markdown;
  }
  if ((command !== 'report' && command !== 'gate') || !subject) {
    throw new Error(usage());
  }

  const specPath = subject;
  const options = parseOptions(rest);
  const report = await reportFromSpec(specPath);
  if (command === 'gate') {
    const result = evaluateM3Gate(report, { minTokenReductionRatio: options.minTokenReductionRatio });
    if (!result.passed) throw new M3GateFailedError(result);
    return renderM3GateResult(result);
  }

  const markdown = renderMarkdownReport(report);

  if (options.out) {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, markdown, 'utf8');
  }

  if (options.exportJsonl) {
    await exportSuccessfulTrajectories(
      options.exportJsonl,
      (await cellsFromSpecAt(specPath))
        .filter((cell) => cell.status === 'success')
        .map((cell) => ({ runId: cell.runId, trajectory: cell.trajectory })),
    );
  }

  if (options.out && options.exportJsonl) return `wrote ${options.out} and ${join(options.exportJsonl, '<run_id>.jsonl')}`;
  if (options.out) return `wrote ${options.out}`;
  return markdown;
}

async function reportFromSpec(specPath: string) {
  return buildBenchReport(await cellsFromSpecAt(specPath));
}

async function cellsFromSpecAt(specPath: string) {
  const resolvedSpecPath = resolve(specPath);
  const spec = parseBenchmarkSpec(JSON.parse(await readFile(resolvedSpecPath, 'utf8')));
  return cellsFromSpec(spec, { specDir: dirname(resolvedSpecPath) });
}

function parseG2ReportOptions(args: string[]): { roteManifests: string; browserDumps: string; out: string; summary: string; minRuns: number } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!flag || !value || !['--rote-manifests', '--browser-dumps', '--out', '--summary', '--min-runs'].includes(flag)) {
      throw new Error('g2-report requires --rote-manifests, --browser-dumps, --out, and --summary [--min-runs 15]');
    }
    values.set(flag, value);
  }
  const roteManifests = values.get('--rote-manifests'); const browserDumps = values.get('--browser-dumps');
  const out = values.get('--out'); const summary = values.get('--summary'); const minRuns = Number(values.get('--min-runs') ?? '15');
  if (!roteManifests || !browserDumps || !out || !summary || !Number.isInteger(minRuns) || minRuns < 15) {
    throw new Error('g2-report requires --rote-manifests, --browser-dumps, --out, and --summary [--min-runs 15]');
  }
  return { roteManifests, browserDumps, out, summary, minRuns };
}

function parseCurveCacheReportOptions(args: string[]): { after: string; baseline: string; out: string; svg: string; summary: string; subjectProtocolSuffix: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!flag || !value || !['--after', '--baseline', '--out', '--svg', '--summary', '--subject-protocol-suffix'].includes(flag)) {
      throw new Error('curve-cache-report requires --after, --baseline, --out, --svg, --summary, and --subject-protocol-suffix');
    }
    values.set(flag, value);
  }
  const after = values.get('--after'); const baseline = values.get('--baseline'); const out = values.get('--out');
  const svg = values.get('--svg'); const summary = values.get('--summary'); const subjectProtocolSuffix = values.get('--subject-protocol-suffix');
  if (!after || !baseline || !out || !svg || !summary || !subjectProtocolSuffix) {
    throw new Error('curve-cache-report requires --after, --baseline, --out, --svg, --summary, and --subject-protocol-suffix');
  }
  return { after, baseline, out, svg, summary, subjectProtocolSuffix };
}

function parseCurveReportOptions(args: string[]): { baseline: string; out: string; svg: string; summary: string; slopeFloor: number; subjectProtocolSuffix?: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !value || !['--baseline', '--out', '--svg', '--summary', '--slope-floor', '--subject-protocol-suffix'].includes(flag)) {
      throw new Error('curve-report requires --baseline <jsonl> --out <md> --svg <svg> --summary <json> [--slope-floor <ratio>]');
    }
    values.set(flag, value);
  }
  const baseline = values.get('--baseline'); const out = values.get('--out');
  const svg = values.get('--svg'); const summary = values.get('--summary');
  const slopeFloor = Number(values.get('--slope-floor') ?? '0.30');
  if (!baseline || !out || !svg || !summary || !Number.isFinite(slopeFloor) || slopeFloor < 0 || slopeFloor > 1) {
    throw new Error('curve-report requires --baseline <jsonl> --out <md> --svg <svg> --summary <json> [--slope-floor <ratio>]');
  }
  const subjectProtocolSuffix = values.get('--subject-protocol-suffix');
  return { baseline, out, svg, summary, slopeFloor, ...(subjectProtocolSuffix ? { subjectProtocolSuffix } : {}) };
}

function parseCurvePreflightOptions(args: string[]): { out: string; threshold: number } {
  let out: string | undefined;
  let threshold = 1024;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) throw new Error('curve-cache-preflight requires --out <report.json> [--threshold <tokens>]');
    if (flag === '--out') out = value;
    else if (flag === '--threshold' && Number.isInteger(Number(value)) && Number(value) > 0) threshold = Number(value);
    else throw new Error(`unknown or invalid curve-cache-preflight option: ${String(flag)}`);
  }
  if (!out) throw new Error('curve-cache-preflight requires --out <report.json>');
  return { out, threshold };
}

function parseSerializerOptions(args: string[]): Pick<ReportOptions, 'out'> {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === '--out' && args[1]) return { out: args[1] };
  throw new Error('serializer comparison accepts only --out <report.md>');
}

interface CompetitorRecordsOptions {
  harness: string;
  model: string;
  cacheAdjusted: boolean;
  configNotes?: string;
  out?: string;
}

/**
 * Parses the competitor mapping options. `--harness`, `--model` and
 * `--cache-adjusted` are all required with no defaults: fairness provenance is
 * what makes the published number auditable (docs/03), and a defaulted
 * `cache_adjusted` would let un-adjusted competitor counts be compared without
 * it showing anywhere in the record.
 */
function parseCompetitorRecordsOptions(args: string[]): CompetitorRecordsOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(competitorRecordsUsage());
    if (!['--harness', '--model', '--cache-adjusted', '--config-notes', '--out'].includes(flag)) {
      throw new Error(`unknown option: ${flag}`);
    }
    values.set(flag, value);
  }
  const harness = values.get('--harness');
  const model = values.get('--model');
  const cacheAdjusted = values.get('--cache-adjusted');
  if (!harness || !model || cacheAdjusted === undefined) throw new Error(competitorRecordsUsage());
  if (cacheAdjusted !== 'true' && cacheAdjusted !== 'false') throw new Error('--cache-adjusted must be true or false');
  return {
    harness,
    model,
    cacheAdjusted: cacheAdjusted === 'true',
    configNotes: values.get('--config-notes'),
    out: values.get('--out'),
  };
}

function competitorRecordsUsage(): string {
  return 'rote-bench competitor-records <raw-runs.json> --harness <id> --model <model> --cache-adjusted <true|false> [--config-notes <text>] [--out records.json]';
}

function parseOptions(args: string[]): ReportOptions {
  const options: ReportOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out') {
      const value = args[i + 1];
      if (!value) throw new Error('--out requires a path');
      options.out = value;
      i += 1;
      continue;
    }
    if (arg === '--export-jsonl') {
      const value = args[i + 1];
      if (!value) throw new Error('--export-jsonl requires a directory');
      options.exportJsonl = value;
      i += 1;
      continue;
    }
    if (arg === '--min-runs') {
      const value = args[i + 1];
      if (!value) throw new Error('--min-runs requires a number');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--min-runs must be a positive integer');
      options.minRuns = parsed;
      i += 1;
      continue;
    }
    if (arg === '--prices') {
      const value = args[i + 1];
      if (!value) throw new Error('--prices requires a path to a price table JSON file');
      options.prices = value;
      i += 1;
      continue;
    }
    if (arg === '--subject') {
      const value = args[i + 1];
      if (!value) throw new Error('--subject requires a harness id');
      options.subject = value;
      i += 1;
      continue;
    }
    if (arg === '--min-token-reduction') {
      const value = args[i + 1];
      if (!value) throw new Error('--min-token-reduction requires a number');
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error('--min-token-reduction must be between 0 and 1');
      options.minTokenReductionRatio = parsed;
      i += 1;
      continue;
    }
    throw new Error(`unknown option: ${String(arg)}`);
  }
  return options;
}

function usage(): string {
  return 'usage: rote-bench g2-report <records.json> --rote-manifests <json> --browser-dumps <json> --out report.md --summary summary.json [--min-runs 15] | rote-bench curve-dry-run <protocol.json> --out records.jsonl | rote-bench curve-cache-preflight <records.jsonl> --out report.json [--threshold 1024] | rote-bench curve-cache-report <before-rote.jsonl> --after <after-rote.jsonl> --baseline <browser-use.jsonl> --out report.md --svg cost.svg --summary summary.json --subject-protocol-suffix <suffix> | rote-bench curve-report <rote.jsonl> --baseline <browser-use.jsonl> --out report.md --svg curve.svg --summary summary.json [--slope-floor 0.30] [--subject-protocol-suffix <suffix>] | rote-bench curve-browser-use-records <raw-calls.jsonl> --out records.jsonl | rote-bench run <plan.json> --out bench-out | rote-bench report <spec.json> [--out report.md] [--export-jsonl dir] | rote-bench gate <spec.json> [--min-token-reduction 0.8] | rote-bench serializer-report <spec.json> [--out report.md] | rote-bench serializer-gate <spec.json> | rote-bench competitor-records <raw-runs.json> --harness <id> --model <model> --cache-adjusted <true|false> [--config-notes <text>] [--out records.json] | rote-bench records <sources.json> [--out records.json] | rote-bench headhead <records.json> [--subject rote] [--prices prices.json] [--out report.md] | rote-bench launch-gate <records.json> [--subject rote] [--min-token-reduction 0.3] [--min-runs 15] | rote-bench synthetic <out-dir>';
}
