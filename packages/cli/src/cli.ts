import { formatRunDetail, formatRunsList } from './format.js';
import { listRuns, showRun } from './runs.js';

export async function main(argv: string[], baseDir = process.env['ROTE_BASE_DIR'] ?? '.rote'): Promise<string> {
  const [group, subcommand, ...rest] = argv;
  if (group === 'runs' && subcommand === 'ls') {
    return formatRunsList(await listRuns(baseDir));
  }
  if (group === 'runs' && subcommand === 'show') {
    const runId = rest[0];
    if (!runId) throw new Error('usage: rote runs show <run_id>');
    return formatRunDetail(await showRun(baseDir, runId));
  }
  throw new Error('usage: rote runs ls | rote runs show <run_id>');
}
