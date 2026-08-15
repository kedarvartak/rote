import { parseTrajectoryJsonl, type TrajectoryEvent } from '@rote/core';
import { actionKeyFromEvent, type ActionKey } from './action-key.js';

/** One recorded run reduced to its action keys, grouped under a task key. */
export interface RecordedRun {
  runId: string;
  taskKey: string;
  actions: ActionKey[];
}

/** Task key = run id without its `-rNN` repetition suffix (how every T-series data set names runs). */
export function defaultTaskKey(runId: string): string {
  return runId.replace(/-r\d+$/, '');
}

/** Reduces trajectory events to per-run action keys. */
export function runsFromEvents(events: readonly TrajectoryEvent[], taskKey: (runId: string) => string = defaultTaskKey): RecordedRun[] {
  const byRun = new Map<string, TrajectoryEvent[]>();
  for (const event of events) byRun.set(event.run_id, [...(byRun.get(event.run_id) ?? []), event]);
  return [...byRun.entries()].map(([runId, list]) => ({
    runId,
    taskKey: taskKey(runId),
    actions: list.sort((a, b) => a.seq - b.seq).map((event) => actionKeyFromEvent(event)),
  }));
}

/** Parses one trajectory JSONL data set into runs. */
export function runsFromJsonl(text: string, taskKey?: (runId: string) => string): RecordedRun[] {
  return runsFromEvents(parseTrajectoryJsonl(text), taskKey);
}
