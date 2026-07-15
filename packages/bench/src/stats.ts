/**
 * Pure statistics helpers shared by the head-to-head aggregation and the launch
 * gate's bootstrap. No I/O, no clock, no env reads — property-testable, and
 * deterministic so every report and gate render is byte-stable (CLAUDE.md
 * "pure logic lives in dependency-free functions").
 */

/** Arithmetic mean. Returns 0 for an empty input rather than NaN. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Linear-interpolation percentile of an *ascending-sorted* array; `p` in [0,1].
 * Callers must sort — this is on the bootstrap's hot path (10k resamples), so it
 * does not defensively re-sort.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] as number;
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const weight = rank - lo;
  return (sorted[lo] as number) * (1 - weight) + (sorted[hi] as number) * weight;
}

/** Convenience wrapper that sorts a copy before taking the percentile. */
export function percentileOf(values: readonly number[], p: number): number {
  return percentile([...values].sort((a, b) => a - b), p);
}

/**
 * Fractional reduction of `subject` against `baseline` (1 - subject/baseline).
 * Returns 0 when the baseline is non-positive: there is no reduction to claim
 * against a baseline that spent nothing, and a divide-by-zero must never render
 * as an infinite win.
 */
export function reduction(subject: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return 1 - subject / baseline;
}
