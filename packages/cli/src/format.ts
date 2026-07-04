import type { TrajectoryEvent } from '@rote/core';
import type { RunDetail, RunSummary } from './runs.js';

/** Pure text formatting so `rote runs ls`/`show` output is snapshot-testable without spawning the CLI. */

export function formatRunsList(runs: RunSummary[]): string {
  if (runs.length === 0) return 'No runs found.';
  const rows = runs.map((run) => {
    const outcome = run.manifest?.outcome ?? 'in-progress';
    const taskSpec = run.manifest?.task_spec ?? '(no manifest yet)';
    return `${run.run_id}\t${outcome}\t${taskSpec}`;
  });
  return ['RUN_ID\tOUTCOME\tTASK_SPEC', ...rows].join('\n');
}

function formatEvent(event: TrajectoryEvent): string {
  const status = event.error ? `error: ${event.error.message}` : 'ok';
  return `  [${event.seq}] ${event.tool}(${JSON.stringify(event.args)}) -> ${status} (${event.duration_ms}ms)`;
}

export function formatRunDetail(detail: RunDetail): string {
  const lines: string[] = [`run_id: ${detail.run_id}`];
  if (detail.manifest) {
    lines.push(`task_spec: ${detail.manifest.task_spec}`);
    lines.push(`outcome: ${detail.manifest.outcome}`);
    lines.push(`started_at: ${detail.manifest.started_at}`);
    if (detail.manifest.ended_at) lines.push(`ended_at: ${detail.manifest.ended_at}`);
  } else {
    lines.push('manifest: (none yet — run may still be in progress)');
  }
  lines.push(`events (${detail.events.length}):`);
  lines.push(...detail.events.map(formatEvent));
  return lines.join('\n');
}
