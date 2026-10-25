/** Redacted trajectory fields used to measure B4 history-compaction economics. */
export interface B4TrajectoryEvent {
  seq: number;
  args: Record<string, unknown>;
  result: unknown;
}

export interface B4CompactionBoundary {
  step: number;
  compacted_action_count: number;
  through_action_index: number;
  retained_representative_count: number;
  history_digest: string;
}

export interface B4RunEvidence {
  action_steps: number;
  max_action_history_actions: number;
  max_visible_history_actions: number;
  compaction_boundaries: number;
  compacted_action_count: number;
  recall_unavailable_steps: number;
  compaction: B4CompactionBoundary[];
}

/**
 * Measures only redacted compaction metadata. Typed action arguments are
 * inspected for the failure classification but never copied into evidence.
 * Missing compaction metadata leaves the run retained with an honest zero
 * boundary count; callers decide whether that makes a gate certifiable.
 */
export function summarizeB4Trajectory(events: readonly B4TrajectoryEvent[]): B4RunEvidence {
  let maxActionHistory = 0;
  let maxVisibleHistory = 0;
  let compactedActionCount = 0;
  let recallUnavailable = 0;
  const compaction: B4CompactionBoundary[] = [];
  for (const [index, event] of events.entries()) {
    maxActionHistory = Math.max(maxActionHistory, index);
    const result = record(event.result);
    const history = record(result?.history_compaction);
    if (history
      && integer(history.compactedActionCount)
      && integer(history.throughActionIndex)
      && integer(history.retainedRepresentativeCount)
      && typeof history.historyDigest === 'string') {
      const compacted = history.compactedActionCount;
      const recent = Math.max(0, index - compacted);
      maxVisibleHistory = Math.max(maxVisibleHistory, history.retainedRepresentativeCount + recent);
      compactedActionCount += compacted;
      compaction.push({
        step: event.seq,
        compacted_action_count: compacted,
        through_action_index: history.throughActionIndex,
        retained_representative_count: history.retainedRepresentativeCount,
        history_digest: history.historyDigest,
      });
    } else {
      maxVisibleHistory = Math.max(maxVisibleHistory, index);
    }
    const failure = event.args.failureClassification;
    if (failure === 'recall_unavailable' || result?.failureClassification === 'recall_unavailable') recallUnavailable += 1;
  }
  return {
    action_steps: events.length,
    max_action_history_actions: maxActionHistory,
    max_visible_history_actions: maxVisibleHistory,
    compaction_boundaries: compaction.length,
    compacted_action_count: compactedActionCount,
    recall_unavailable_steps: recallUnavailable,
    compaction,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
