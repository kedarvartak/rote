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
import { assembleHeadToHeadRecords } from './headhead-assembler.js';

interface ReportOptions {
  out?: string;
  exportJsonl?: string;
  minTokenReductionRatio?: number;
  minRuns?: number;
  subject?: string;
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
    const result = buildHeadToHead(records, { subject: options.subject });
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

function parseSerializerOptions(args: string[]): Pick<ReportOptions, 'out'> {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === '--out' && args[1]) return { out: args[1] };
  throw new Error('serializer comparison accepts only --out <report.md>');
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
  return 'usage: rote-bench run <plan.json> --out bench-out | rote-bench report <spec.json> [--out report.md] [--export-jsonl dir] | rote-bench gate <spec.json> [--min-token-reduction 0.8] | rote-bench serializer-report <spec.json> [--out report.md] | rote-bench serializer-gate <spec.json> | rote-bench records <sources.json> [--out records.json] | rote-bench headhead <records.json> [--subject rote] [--out report.md] | rote-bench launch-gate <records.json> [--subject rote] [--min-token-reduction 0.3] [--min-runs 15] | rote-bench synthetic <out-dir>';
}
