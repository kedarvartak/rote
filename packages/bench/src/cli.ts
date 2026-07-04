import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildBenchReport } from './accounting.js';
import { renderMarkdownReport } from './report.js';
import { exportSuccessfulTrajectories } from './run-store.js';
import { cellsFromSpec, parseBenchmarkSpec } from './spec.js';

interface ReportOptions {
  out?: string;
  exportJsonl?: string;
}

/** CLI entrypoint for M3 report generation from recorded run artifacts. */
export async function main(argv: string[]): Promise<string> {
  const [command, specPath, ...rest] = argv;
  if (command !== 'report' || !specPath) {
    throw new Error('usage: rote-bench report <spec.json> [--out report.md] [--export-jsonl dir]');
  }

  const options = parseOptions(rest);
  const resolvedSpecPath = resolve(specPath);
  const spec = parseBenchmarkSpec(JSON.parse(await readFile(resolvedSpecPath, 'utf8')));
  const cells = await cellsFromSpec(spec, { specDir: dirname(resolvedSpecPath) });
  const report = buildBenchReport(cells);
  const markdown = renderMarkdownReport(report);

  if (options.out) {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, markdown, 'utf8');
  }

  if (options.exportJsonl) {
    await exportSuccessfulTrajectories(
      options.exportJsonl,
      cells
        .filter((cell) => cell.status === 'success')
        .map((cell) => ({ runId: cell.runId, trajectory: cell.trajectory })),
    );
  }

  if (options.out && options.exportJsonl) return `wrote ${options.out} and ${join(options.exportJsonl, '<run_id>.jsonl')}`;
  if (options.out) return `wrote ${options.out}`;
  return markdown;
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
    throw new Error(`unknown option: ${String(arg)}`);
  }
  return options;
}
