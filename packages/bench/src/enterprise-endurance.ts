import { z } from 'zod';
import { HistoryCompactionPolicySchema, type HistoryCompactionPolicy } from '@rote/agent';

// see docs/05-roadmap.md P2 item 7 (#132) — E7.6 certifies that a 50+ transition
// single-session SPA workflow completes under the frozen B4 policy with bounded
// context, bounded settle time, bounded recorder growth, and exact authoritative
// verification. Everything here is pure accounting over records the real-Chrome
// harness produces; nothing in this module can make a run pass.

/**
 * Bounded settledness policy for long-lived SPA sessions (units in names).
 * `maxPendingRequests: 1` tolerates one background request (heartbeat/long-poll)
 * while the DOM must still be quiet for the whole window; `timeoutMs` turns an
 * unbounded wait into a typed `SettlednessTimeoutError`. Frozen for T34.
 */
export const ENDURANCE_SETTLEDNESS_POLICY = Object.freeze({
  quietWindowMs: 150,
  pollIntervalMs: 25,
  timeoutMs: 5_000,
  maxPendingRequests: 1,
});

/** One planner step as measured by the endurance harness. */
export const EnduranceStepSampleSchema = z.object({
  step: z.number().int().nonnegative(),
  /** Bytes of stable prefix + volatile suffix handed to the planner (UTF-16 code units). */
  context_chars: z.number().int().nonnegative(),
  volatile_chars: z.number().int().nonnegative(),
  observation_chars: z.number().int().nonnegative(),
  observation_mode: z.enum(['full', 'diff', 'summary', 'bootstrap']),
  visible_actions: z.number().int().nonnegative(),
  /** `throughActionIndex` of the compaction record, or null when uncompacted. */
  compacted_through: z.number().int().nonnegative().nullable(),
  route_changed: z.boolean(),
  document_changed: z.boolean(),
  /** Milliseconds spent in the settledness gate for this step's dispatch. */
  settle_ms: z.number().nonnegative(),
  /** Trajectory JSONL bytes on disk after this step was recorded. */
  recorder_bytes: z.number().int().nonnegative(),
});
export type EnduranceStepSample = z.infer<typeof EnduranceStepSampleSchema>;

/** One fresh endurance run against the frozen E7-SPA-60 contract. */
export const EnduranceRunRecordSchema = z.object({
  run_index: z.number().int().nonnegative(),
  transitions_expected: z.number().int().positive(),
  transitions_completed: z.number().int().nonnegative(),
  success: z.boolean(),
  failure_classification: z.string().optional(),
  /** Projected oracle events equal the protocol's frozen expected events, in order. */
  evidence_exact: z.boolean(),
  dispatch_count: z.number().int().nonnegative(),
  steps: z.array(EnduranceStepSampleSchema),
  settle: z.object({
    samples: z.number().int().nonnegative(),
    total_ms: z.number().nonnegative(),
    max_ms: z.number().nonnegative(),
    timeouts: z.number().int().nonnegative(),
  }),
  duration_ms: z.number().nonnegative(),
});
export type EnduranceRunRecord = z.infer<typeof EnduranceRunRecordSchema>;

/**
 * Largest action count the planner can see under a B4 policy: representatives
 * plus the exact tail just before the next 16-action boundary. Beyond this the
 * policy is not bounding history.
 */
export function visibleActionBound(policy: HistoryCompactionPolicy): number {
  const parsed = HistoryCompactionPolicySchema.parse(policy);
  return Math.max(
    parsed.maxActionsBeforeCompaction,
    parsed.representativeActionLimit + parsed.recentActionCount + parsed.compactionInterval - 1,
  );
}

/** Distinct compaction boundaries (each one is an honest planner-cache miss) for `actionCount` prior actions. */
export function expectedCompactionBoundaries(policy: HistoryCompactionPolicy, actionCount: number): number {
  const parsed = HistoryCompactionPolicySchema.parse(policy);
  const boundaries = new Set<number>();
  for (let actions = 0; actions <= actionCount; actions += 1) {
    if (actions <= parsed.maxActionsBeforeCompaction) continue;
    const compacted = Math.floor((actions - parsed.recentActionCount) / parsed.compactionInterval) * parsed.compactionInterval;
    if (compacted > 0) boundaries.add(compacted);
  }
  return boundaries.size;
}

export interface EnduranceCertificationOptions {
  minRuns: number;
  transitions: number;
  compactionPolicy: HistoryCompactionPolicy;
  observationMaxChars: number;
  /** Ceiling for an explicit bootstrap snapshot when no diff fits `observationMaxChars`. */
  observationBootstrapMaxChars: number;
  settleTimeoutMs: number;
  /** Minimum share of post-base steps that must be served as diffs (default 0.8). */
  minDiffShare?: number;
  /** Allowed growth of per-boundary peak volatile chars between successive windows (0.05 = 5%). */
  peakGrowthTolerance?: number;
}

export interface EnduranceCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface EnduranceCertification {
  certified: boolean;
  checks: EnduranceCheck[];
  metrics: {
    runs: number;
    transitions_completed_min: number;
    max_visible_actions: number;
    visible_action_bound: number;
    compaction_boundaries_per_run: number;
    max_context_chars: number;
    max_volatile_chars: number;
    route_changes_per_run_min: number;
    document_changes_total: number;
    settle_total_ms_max: number;
    settle_max_ms: number;
    recorder_bytes_max: number;
  };
}

/** Evaluates the E7.6 acceptance checks over fresh run records; every failure names its reason. */
export function certifyEndurance(
  records: readonly EnduranceRunRecord[],
  options: EnduranceCertificationOptions,
): EnduranceCertification {
  const runs = records.map((record) => EnduranceRunRecordSchema.parse(record));
  const tolerance = options.peakGrowthTolerance ?? 0.05;
  const bound = visibleActionBound(options.compactionPolicy);
  const expectedBoundaries = expectedCompactionBoundaries(options.compactionPolicy, options.transitions);
  const checks: EnduranceCheck[] = [];
  const check = (id: string, passed: boolean, detail: string) => { checks.push({ id, passed, detail }); };

  check('run_count', runs.length >= options.minRuns, `${runs.length} fresh runs (minimum ${options.minRuns})`);
  const failed = runs.filter((run) => !run.success || !run.evidence_exact || run.transitions_completed !== options.transitions);
  check('exact_authoritative_success', failed.length === 0,
    failed.length === 0
      ? `every run completed ${options.transitions} transitions with the exact frozen oracle`
      : `runs ${failed.map((run) => run.run_index).join(',')} did not complete with exact evidence`);
  const overDispatched = runs.filter((run) => run.dispatch_count !== options.transitions);
  check('dispatch_count_exact', overDispatched.length === 0,
    overDispatched.length === 0 ? `dispatch_count == ${options.transitions} in every run` : `runs ${overDispatched.map((run) => run.run_index).join(',')} dispatched a different count`);

  const documentChanges = runs.reduce((sum, run) => sum + run.steps.filter((step) => step.document_changed).length, 0);
  const routeChangesMin = Math.min(...runs.map((run) => run.steps.filter((step) => step.route_changed).length));
  check('route_epochs_not_navigations', documentChanges === 0 && routeChangesMin === options.transitions,
    `${routeChangesMin}+ route changes per run; ${documentChanges} document changes (diff base retained across every route push)`);

  const maxVisible = Math.max(...runs.flatMap((run) => run.steps.map((step) => step.visible_actions)));
  check('history_bounded_by_policy', maxVisible <= bound, `max visible actions ${maxVisible} <= policy bound ${bound}`);
  const boundaryCounts = runs.map((run) => new Set(run.steps.map((step) => step.compacted_through).filter((value) => value !== null)).size);
  check('compaction_boundaries_reported', boundaryCounts.every((count) => count === expectedBoundaries),
    `${expectedBoundaries} compaction boundaries (planner-history cache misses) per run, observed ${[...new Set(boundaryCounts)].join('/')}`);

  const peakGrowth = runs.map((run) => peakGrowthAcrossBoundaries(run.steps));
  const worstGrowth = Math.max(...peakGrowth);
  check('context_peaks_do_not_grow', worstGrowth <= tolerance,
    `worst peak-to-peak volatile growth ${(worstGrowth * 100).toFixed(1)}% (tolerance ${(tolerance * 100).toFixed(0)}%)`);
  const allSteps = runs.flatMap((run) => run.steps);
  const budgeted = allSteps.filter((step) => step.observation_mode !== 'bootstrap');
  const bootstraps = allSteps.filter((step) => step.observation_mode === 'bootstrap');
  const maxBudgeted = Math.max(0, ...budgeted.map((step) => step.observation_chars));
  const maxBootstrap = Math.max(0, ...bootstraps.map((step) => step.observation_chars));
  check('observation_bounded', maxBudgeted <= options.observationMaxChars && maxBootstrap <= options.observationBootstrapMaxChars,
    `max budgeted observation ${maxBudgeted} chars <= ${options.observationMaxChars}; ${bootstraps.length} explicit bootstrap snapshots, max ${maxBootstrap} chars <= ${options.observationBootstrapMaxChars}`);
  // Eviction has to actually happen for the run to say anything about it: after
  // the initial base, transitions must mostly render as diffs against the
  // retained same-document base. Bootstraps are reported, never hidden.
  const minDiffShare = options.minDiffShare ?? 0.8;
  const diffShares = runs.map((run) => {
    const afterBase = run.steps.slice(1);
    return afterBase.length === 0 ? 0 : afterBase.filter((step) => step.observation_mode === 'diff').length / afterBase.length;
  });
  const worstShare = Math.min(...diffShares);
  check('observation_eviction_exercised', worstShare >= minDiffShare,
    `${(worstShare * 100).toFixed(0)}%+ of post-base steps per run served as diffs (minimum ${(minDiffShare * 100).toFixed(0)}%); ${bootstraps.length} bootstrap snapshots across all runs (one initial base per run is expected)`);

  const settleTimeouts = runs.reduce((sum, run) => sum + run.settle.timeouts, 0);
  const settleMax = Math.max(...runs.map((run) => run.settle.max_ms));
  check('settledness_bounded', settleTimeouts === 0 && settleMax <= options.settleTimeoutMs,
    `${settleTimeouts} settle timeouts; slowest settle ${settleMax.toFixed(0)} ms <= ${options.settleTimeoutMs} ms`);

  const recorderGrowth = runs.map((run) => recorderGrowthRatio(run.steps));
  const worstRecorder = Math.max(...recorderGrowth);
  check('recorder_growth_linear', worstRecorder <= 1.25,
    `last-third recorder bytes/step is ${worstRecorder.toFixed(2)}x the middle third (limit 1.25x)`);

  return {
    certified: checks.every((entry) => entry.passed),
    checks,
    metrics: {
      runs: runs.length,
      transitions_completed_min: Math.min(...runs.map((run) => run.transitions_completed)),
      max_visible_actions: maxVisible,
      visible_action_bound: bound,
      compaction_boundaries_per_run: expectedBoundaries,
      max_context_chars: Math.max(...runs.flatMap((run) => run.steps.map((step) => step.context_chars))),
      max_volatile_chars: Math.max(...runs.flatMap((run) => run.steps.map((step) => step.volatile_chars))),
      route_changes_per_run_min: routeChangesMin,
      document_changes_total: documentChanges,
      settle_total_ms_max: Math.max(...runs.map((run) => run.settle.total_ms)),
      settle_max_ms: settleMax,
      recorder_bytes_max: Math.max(...runs.flatMap((run) => run.steps.map((step) => step.recorder_bytes))),
    },
  };
}

/**
 * B4 history is a sawtooth: it grows between boundaries and drops at each one.
 * "Bounded" means successive peaks do not climb — the largest volatile suffix in
 * each post-boundary window is compared with the window before it.
 */
function peakGrowthAcrossBoundaries(steps: readonly EnduranceStepSample[]): number {
  const windows = new Map<number | null, number>();
  for (const step of steps) {
    windows.set(step.compacted_through, Math.max(windows.get(step.compacted_through) ?? 0, step.volatile_chars));
  }
  const peaks = [...windows.entries()]
    .filter(([key]) => key !== null)
    .sort(([left], [right]) => (left as number) - (right as number))
    .map(([, peak]) => peak);
  let worst = 0;
  for (let index = 1; index < peaks.length; index += 1) {
    worst = Math.max(worst, peaks[index]! / peaks[index - 1]! - 1);
  }
  return worst;
}

function recorderGrowthRatio(steps: readonly EnduranceStepSample[]): number {
  const third = Math.floor(steps.length / 3);
  if (third < 2) return 0;
  const bytesAt = (index: number) => steps[index]!.recorder_bytes;
  const middle = (bytesAt(2 * third - 1) - bytesAt(third - 1)) / third;
  const last = (bytesAt(3 * third - 1) - bytesAt(2 * third - 1)) / third;
  return middle <= 0 ? 0 : last / middle;
}
