import type { HeadToHeadComparison, HeadToHeadResult } from './competitor.js';
import { mean, percentile, reduction } from './stats.js';

/** Default number of bootstrap resamples; fixed so gate output is deterministic. */
export const DEFAULT_RESAMPLES = 10000;
/** Default two-sided confidence level for the reported reduction range. */
export const DEFAULT_CONFIDENCE = 0.95;
/**
 * Default minimum successful runs per harness before a win can be certified.
 * docs/05-roadmap.md W5 runs ×5; we require more because a bootstrap over
 * fewer than ~15 samples produces a range too wide to trust (the honest coupling:
 * the gate demands enough data instead of pretending a 5-run win is solid).
 */
export const DEFAULT_MIN_RUNS = 15;
/** Fixed bootstrap seed; determinism is required (report/CLI byte-stability tests). */
const BOOTSTRAP_SEED = 0x9e3779b9;

/** A token-reduction estimate with a confidence range, all fractions (0..1). */
export interface ReductionInterval {
  /** Point estimate: 1 - mean(subject)/mean(baseline) on the observed runs. */
  point: number;
  /** Lower bound of the confidence range — the conservative, gate-relevant number. */
  lower: number;
  /** Upper bound of the confidence range — for the published claim's range. */
  upper: number;
  confidence: number;
  resamples: number;
}

export interface BootstrapOptions {
  resamples?: number;
  confidence?: number;
  seed?: number;
}

/**
 * Estimates the token-reduction ratio and a bootstrap confidence range from each
 * harness's per-successful-run token totals. Pure and deterministic: a fixed seed
 * plus fixed resample count give identical output for identical input, so the
 * launch gate and its rendered report are byte-stable.
 *
 * Returns an all-zero interval when either side has no successful runs — a win
 * cannot be estimated against an absent distribution.
 */
export function bootstrapReductionInterval(
  subjectRunTokens: readonly number[],
  baselineRunTokens: readonly number[],
  options: BootstrapOptions = {},
): ReductionInterval {
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
  if (subjectRunTokens.length === 0 || baselineRunTokens.length === 0) {
    return { point: 0, lower: 0, upper: 0, confidence, resamples };
  }

  const point = reduction(mean(subjectRunTokens), mean(baselineRunTokens));
  const random = mulberry32(options.seed ?? BOOTSTRAP_SEED);
  const draws: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const subjectMean = resampleMean(subjectRunTokens, random);
    const baselineMean = resampleMean(baselineRunTokens, random);
    draws.push(reduction(subjectMean, baselineMean));
  }
  draws.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  return {
    point,
    lower: percentile(draws, alpha),
    upper: percentile(draws, 1 - alpha),
    confidence,
    resamples,
  };
}

/**
 * Estimates a reduction interval by resampling matched repetition pairs.
 * Both vectors must use identical repetition order; pairing preserves shared
 * provider and machine conditions rather than treating alternated runs as independent.
 */
export function bootstrapMatchedReductionInterval(
  subjectValues: readonly number[],
  baselineValues: readonly number[],
  options: BootstrapOptions = {},
): ReductionInterval {
  if (subjectValues.length !== baselineValues.length || subjectValues.length === 0) {
    throw new Error('matched bootstrap requires equal non-empty vectors');
  }
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
  const random = mulberry32(options.seed ?? BOOTSTRAP_SEED);
  const draws: number[] = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    let subjectTotal = 0; let baselineTotal = 0;
    for (let draw = 0; draw < subjectValues.length; draw += 1) {
      const index = Math.floor(random() * subjectValues.length);
      subjectTotal += subjectValues[index]!;
      baselineTotal += baselineValues[index]!;
    }
    draws.push(reduction(subjectTotal / subjectValues.length, baselineTotal / baselineValues.length));
  }
  draws.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  return {
    point: reduction(mean(subjectValues), mean(baselineValues)),
    lower: percentile(draws, alpha),
    upper: percentile(draws, 1 - alpha),
    confidence,
    resamples,
  };
}

export interface LaunchGateOptions {
  /**
   * Minimum reduction the *lower bound* of the range must clear. docs/05 W5 asks
   * only for a win that survives variance; the floor sets how bold the claim is.
   * Default 0 = "confident the reduction is real and positive"; raise it (e.g.
   * 0.3) to certify "at least 30% cheaper" with confidence.
   */
  minTokenReductionRatio?: number;
  /** Minimum successful runs per harness; below this the win is not certifiable. */
  minRuns?: number;
  resamples?: number;
  confidence?: number;
  seed?: number;
}

export interface LaunchGateComparisonResult {
  task: string;
  subject_harness: string;
  baseline_harness: string;
  passed: boolean;
  reduction: ReductionInterval;
  success_parity: boolean;
  subject_runs: number;
  baseline_runs: number;
  reasons: string[];
}

export interface LaunchGateResult {
  passed: boolean;
  minTokenReductionRatio: number;
  minRuns: number;
  comparisons: LaunchGateComparisonResult[];
}

/** Raised by the CLI so a failed launch gate exits non-zero in CI. */
export class LaunchGateFailedError extends Error {
  constructor(public readonly result: LaunchGateResult) {
    super(renderLaunchGateResult(result));
    this.name = 'LaunchGateFailedError';
  }
}

/**
 * Evaluates docs/05-roadmap.md's W5 launch gate. A comparison passes only
 * when all hold: success parity, enough successful runs per harness, and a
 * bootstrap confidence range whose lower bound clears the reduction floor. The
 * overall gate passes only if every comparison passes and there is at least one —
 * an empty head-to-head is a failure, never a silent pass (CLAUDE.md invariant 1).
 */
export function evaluateLaunchGate(
  result: HeadToHeadResult,
  options: LaunchGateOptions = {},
): LaunchGateResult {
  const minTokenReductionRatio = options.minTokenReductionRatio ?? 0;
  const minRuns = options.minRuns ?? DEFAULT_MIN_RUNS;
  const comparisons = result.comparisons.map((c) =>
    evaluateComparison(result.subject_harness, c, minTokenReductionRatio, minRuns, options),
  );
  return {
    passed: comparisons.length > 0 && comparisons.every((c) => c.passed),
    minTokenReductionRatio,
    minRuns,
    comparisons,
  };
}

/** Deterministically renders the launch gate, showing the reduction range, for humans and CI. */
export function renderLaunchGateResult(result: LaunchGateResult): string {
  const lines = [
    `Launch gate: ${result.passed ? 'PASS' : 'FAIL'} (floor ${pct(result.minTokenReductionRatio)} on the range lower bound, min ${result.minRuns} runs/harness)`,
    '',
    '| Task | Baseline | Reduction (range) | Parity | Runs S/B | Status | Reasons |',
    '|---|---|---:|---|---:|---|---|',
  ];
  const sorted = [...result.comparisons].sort(
    (a, b) => a.task.localeCompare(b.task) || a.baseline_harness.localeCompare(b.baseline_harness),
  );
  for (const c of sorted) {
    const range = `${pct(c.reduction.point)} [${pct(c.reduction.lower)}–${pct(c.reduction.upper)}]`;
    lines.push(
      `| ${cell(c.task)} | ${cell(c.baseline_harness)} | ${range} | ${c.success_parity ? 'yes' : 'NO'} | ${c.subject_runs}/${c.baseline_runs} | ${c.passed ? 'PASS' : 'FAIL'} | ${cell(c.reasons.join('; ') || 'ok')} |`,
    );
  }
  if (result.comparisons.length === 0) {
    lines.push('| — | — | 0.0% [0.0%–0.0%] | NO | 0/0 | FAIL | no head-to-head comparisons found |');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function evaluateComparison(
  subjectHarness: string,
  comparison: HeadToHeadComparison,
  minTokenReductionRatio: number,
  minRuns: number,
  options: BootstrapOptions,
): LaunchGateComparisonResult {
  const subjectRuns = comparison.subject.success_total_tokens.length;
  const baselineRuns = comparison.baseline.success_total_tokens.length;
  const interval = bootstrapReductionInterval(
    comparison.subject.success_total_tokens,
    comparison.baseline.success_total_tokens,
    options,
  );
  const reasons: string[] = [];

  if (!comparison.success_parity) {
    reasons.push(
      `success ${pct(comparison.subject.success_rate)} < baseline ${pct(comparison.baseline.success_rate)}`,
    );
  }
  if (comparison.subject.model !== comparison.baseline.model) {
    reasons.push(`model mismatch ${comparison.subject.model} != ${comparison.baseline.model}`);
  }
  if (!comparison.subject.cache_adjusted || !comparison.baseline.cache_adjusted) {
    reasons.push('logical token totals are not provider-cache-adjusted');
  }
  if (subjectRuns < minRuns || baselineRuns < minRuns) {
    reasons.push(`insufficient successful runs ${subjectRuns}/${baselineRuns} < ${minRuns} to certify variance`);
  }
  if (interval.lower < minTokenReductionRatio) {
    reasons.push(`range lower bound ${pct(interval.lower)} < floor ${pct(minTokenReductionRatio)}`);
  }

  return {
    task: comparison.task,
    subject_harness: subjectHarness,
    baseline_harness: comparison.baseline.harness,
    passed: reasons.length === 0,
    reduction: interval,
    success_parity: comparison.success_parity,
    subject_runs: subjectRuns,
    baseline_runs: baselineRuns,
    reasons,
  };
}

/** One bootstrap resample mean: draw values.length items with replacement. */
function resampleMean(values: readonly number[], random: () => number): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[Math.floor(random() * values.length)] as number;
  }
  return sum / values.length;
}

/** Small deterministic PRNG (mulberry32) so bootstrap output is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
