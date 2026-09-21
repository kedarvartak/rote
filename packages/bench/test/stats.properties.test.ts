import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mean, mulberry32, percentileOf, reduction, wilsonInterval } from '../src/stats.js';

// CLAUDE.md "Testing": property-based tests for the pure accounting logic, and
// docs/03 §variance: the published claim is a seeded interval's lower bound. A
// statistics kernel with more than one implementation is a kernel whose numbers
// cannot be reproduced from the record — these properties are what let there be
// exactly one.

const rate = fc.tuple(fc.nat({ max: 500 }), fc.integer({ min: 1, max: 500 }))
  .map(([successes, attempts]) => [Math.min(successes, attempts), attempts] as const);

describe('wilsonInterval', () => {
  it('always returns a real interval inside [0, 1]', () => {
    fc.assert(fc.property(rate, ([successes, attempts]) => {
      const [lo, hi] = wilsonInterval(successes, attempts);
      expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(hi);
    }));
  });

  it('contains the observed rate', () => {
    fc.assert(fc.property(rate, ([successes, attempts]) => {
      const [lo, hi] = wilsonInterval(successes, attempts);
      const observed = successes / attempts;
      expect(lo).toBeLessThanOrEqual(observed + 1e-12);
      expect(hi).toBeGreaterThanOrEqual(observed - 1e-12);
    }));
  });

  it('narrows as evidence accumulates at a fixed rate', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), (attempts) => {
      const [loSmall, hiSmall] = wilsonInterval(attempts, attempts);
      const [loBig, hiBig] = wilsonInterval(attempts * 4, attempts * 4);
      expect(hiBig - loBig).toBeLessThanOrEqual(hiSmall - loSmall);
    }));
  });

  it('never collapses to a point at 0 or 100 percent, where a normal approximation would', () => {
    // The reason for choosing Wilson: small cells at the boundary are exactly
    // where a benchmark is tempted to publish false certainty.
    fc.assert(fc.property(fc.integer({ min: 1, max: 200 }), (attempts) => {
      expect(wilsonInterval(attempts, attempts)[0]).toBeLessThan(1);
      expect(wilsonInterval(0, attempts)[1]).toBeGreaterThan(0);
    }));
  });

  it('refuses an interval over no attempts instead of returning NaN', () => {
    // One of the five copies this kernel replaced had lost this guard, so a
    // zero-attempt cell rendered "[NaN, NaN]" as though it were a measurement.
    expect(() => wilsonInterval(0, 0)).toThrow(/at least one attempt/);
    expect(() => wilsonInterval(0, -1)).toThrow(/at least one attempt/);
  });
});

describe('mulberry32', () => {
  it('is deterministic: one seed, one stream', () => {
    fc.assert(fc.property(fc.integer(), fc.integer({ min: 1, max: 50 }), (seed, draws) => {
      const a = mulberry32(seed), b = mulberry32(seed);
      for (let i = 0; i < draws; i++) expect(a()).toBe(b());
    }));
  });

  it('stays in [0, 1)', () => {
    fc.assert(fc.property(fc.integer(), (seed) => {
      const next = mulberry32(seed);
      for (let i = 0; i < 50; i++) {
        const value = next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }));
  });

  it('matches a pinned test vector, so a published bootstrap stays reproducible', () => {
    // The published claim is the lower bound over 10,000 seeded resamples, so
    // the stream is part of the result. If this vector ever changes, every
    // previously published interval becomes unreproducible from the record.
    const next = mulberry32(2026);
    const first = [next(), next(), next(), next(), next()].map((v) => Number(v.toFixed(12)));
    expect(first).toEqual([0.455407699337, 0.308496145997, 0.661157449242, 0.618475218304, 0.152280101785]);
  });
});

describe('reduction', () => {
  it('reports a regression as a negative number rather than hiding it at zero', () => {
    // One of the two copies clamped with Math.max(0, ...), so a head-to-head
    // cell where Rote spent *more* than the baseline published as "0% reduction".
    expect(reduction(120, 100)).toBeCloseTo(-0.2, 12);
    expect(reduction(100, 100)).toBe(0);
    expect(reduction(50, 100)).toBeCloseTo(0.5, 12);
  });

  it('is the fraction saved, and is symmetric with the ratio it implies', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 1e6, noNaN: true }),
      fc.double({ min: 1e-6, max: 1e6, noNaN: true }),
      (subject, baseline) => {
        expect(reduction(subject, baseline)).toBeCloseTo(1 - subject / baseline, 9);
      },
    ));
  });

  it('claims nothing against a baseline that spent nothing', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (subject) => {
      expect(reduction(subject, 0)).toBe(0);
      expect(reduction(subject, -1)).toBe(0);
    }));
  });
});

describe('mean and percentileOf', () => {
  it('mean lies between the extremes and is 0 for no data', () => {
    expect(mean([])).toBe(0);
    fc.assert(fc.property(fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1 }), (values) => {
      const m = mean(values);
      expect(m).toBeGreaterThanOrEqual(Math.min(...values) - 1e-9);
      expect(m).toBeLessThanOrEqual(Math.max(...values) + 1e-9);
    }));
  });

  it('percentiles are ordered and bounded by the sample', () => {
    fc.assert(fc.property(fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 40 }), (values) => {
      const [p05, p50, p95] = [percentileOf(values, 0.05), percentileOf(values, 0.5), percentileOf(values, 0.95)];
      expect(p05).toBeLessThanOrEqual(p50);
      expect(p50).toBeLessThanOrEqual(p95);
      expect(p05).toBeGreaterThanOrEqual(Math.min(...values) - 1e-9);
      expect(p95).toBeLessThanOrEqual(Math.max(...values) + 1e-9);
    }));
  });
});
