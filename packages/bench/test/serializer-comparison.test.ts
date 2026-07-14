import { describe, expect, it } from 'vitest';
import { compareSerializerObservations, renderSerializerComparison } from '../src/index.js';

describe('compareSerializerObservations', () => {
  it('passes only when Rote is no larger on every fixture', () => {
    const result = compareSerializerObservations([
      { id: 'B1', rote_observation: 'short', browser_use_observation: 'a much longer baseline observation' },
      { id: 'B2', rote_observation: 'same', browser_use_observation: 'same' },
    ]);

    expect(result.passed).toBe(true);
    expect(result.rows.every((row) => row.passed)).toBe(true);
    expect(renderSerializerComparison(result)).toContain('Overall: PASS');
  });

  it('fails a character regression even inside the same approximate-token bucket', () => {
    const result = compareSerializerObservations([
      { id: 'small-regression', rote_observation: 'xxxx', browser_use_observation: 'x' },
    ]);

    expect(result.rows[0]?.rote_approx_tokens).toBe(result.rows[0]?.browser_use_approx_tokens);
    expect(result.passed).toBe(false);
  });

  it('fails when one fixture regresses even if aggregate size is smaller', () => {
    const result = compareSerializerObservations([
      { id: 'large-win', rote_observation: 'x', browser_use_observation: 'x'.repeat(1000) },
      { id: 'regression', rote_observation: 'too long', browser_use_observation: 'x' },
    ]);

    expect(result.total_rote_approx_tokens).toBeLessThan(result.total_browser_use_approx_tokens);
    expect(result.passed).toBe(false);
    expect(result.rows.find((row) => row.id === 'regression')?.passed).toBe(false);
  });
});
