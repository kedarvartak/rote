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

/**
 * Wilson score interval for a success rate, at 95% (z = 1.959963984540054).
 *
 * Wilson rather than normal-approximation because benchmark cells are small and
 * often at 0 or 100% success, where the normal interval degenerates to a point
 * and would publish certainty the data does not support (docs/03 §variance).
 *
 * Throws on zero attempts: an interval over nothing is not 0–1, it is undefined,
 * and returning `[NaN, NaN]` would print as an interval in a report.
 */
export function wilsonInterval(successes: number, attempts: number): [number, number] {
  if (attempts < 1) throw new Error('Wilson interval requires at least one attempt');
  const z = 1.959963984540054;
  const p = successes / attempts;
  const denominator = 1 + (z * z) / attempts;
  const center = (p + (z * z) / (2 * attempts)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / attempts) + (z * z) / (4 * attempts * attempts)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/**
 * Seeded PRNG (mulberry32) for the matched-pair bootstrap.
 *
 * The published claim is the interval's lower bound over 10,000 seeded
 * resamples (docs/03 §variance), so the *stream* is part of the result: two
 * implementations that agree today and diverge later would silently make an
 * old number unreproducible. One implementation, pinned by a test vector.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Truncated to 32 bits every step. Letting `state` grow instead agrees for
    // the first ~4.8M draws (the bitwise ops truncate anyway) and then drifts
    // as the addition loses integer precision.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
