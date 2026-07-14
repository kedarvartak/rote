import { z } from 'zod';
import { estimateTokens } from '@rote/perception';

export const SerializerObservationSampleSchema = z.object({
  id: z.string().min(1),
  rote_observation: z.string(),
  browser_use_observation: z.string(),
});
export type SerializerObservationSample = z.infer<typeof SerializerObservationSampleSchema>;

export const SerializerComparisonRowSchema = z.object({
  id: z.string().min(1),
  rote_chars: z.number().int().nonnegative(),
  browser_use_chars: z.number().int().nonnegative(),
  rote_approx_tokens: z.number().int().nonnegative(),
  browser_use_approx_tokens: z.number().int().nonnegative(),
  reduction_ratio: z.number(),
  passed: z.boolean(),
});
export type SerializerComparisonRow = z.infer<typeof SerializerComparisonRowSchema>;

export const SerializerComparisonResultSchema = z.object({
  rows: z.array(SerializerComparisonRowSchema),
  total_rote_approx_tokens: z.number().int().nonnegative(),
  total_browser_use_approx_tokens: z.number().int().nonnegative(),
  reduction_ratio: z.number(),
  passed: z.boolean(),
});
export type SerializerComparisonResult = z.infer<typeof SerializerComparisonResultSchema>;

/** Raised when any fixture exceeds Browser Use's serialized observation size. */
export class SerializerParityGateError extends Error {
  constructor(readonly result: SerializerComparisonResult) {
    super(`serializer parity gate failed: ${result.rows.filter((row) => !row.passed).map((row) => row.id).join(', ')}`);
    this.name = 'SerializerParityGateError';
  }
}

/** Compares Rote and Browser Use observations using one documented approximation. */
export function compareSerializerObservations(
  input: readonly SerializerObservationSample[],
): SerializerComparisonResult {
  const samples = z.array(SerializerObservationSampleSchema).min(1).parse(input);
  const rows = samples.map((sample) => {
    const roteTokens = estimateTokens(sample.rote_observation);
    const browserUseTokens = estimateTokens(sample.browser_use_observation);
    return SerializerComparisonRowSchema.parse({
      id: sample.id,
      rote_chars: sample.rote_observation.length,
      browser_use_chars: sample.browser_use_observation.length,
      rote_approx_tokens: roteTokens,
      browser_use_approx_tokens: browserUseTokens,
      reduction_ratio: reductionRatio(roteTokens, browserUseTokens),
      // Character parity is stricter than the shared coarse token estimate and avoids
      // hiding small regressions inside the same four-character bucket.
      passed: sample.rote_observation.length <= sample.browser_use_observation.length,
    });
  });
  const totalRote = rows.reduce((sum, row) => sum + row.rote_approx_tokens, 0);
  const totalBrowserUse = rows.reduce((sum, row) => sum + row.browser_use_approx_tokens, 0);
  return SerializerComparisonResultSchema.parse({
    rows,
    total_rote_approx_tokens: totalRote,
    total_browser_use_approx_tokens: totalBrowserUse,
    reduction_ratio: reductionRatio(totalRote, totalBrowserUse),
    passed: rows.every((row) => row.passed),
  });
}

/** Renders a deterministic Markdown serializer comparison report. */
export function renderSerializerComparison(result: SerializerComparisonResult): string {
  const lines = [
    '# Serializer comparison: Rote vs Browser Use',
    '',
    '> Token counts are the documented `ceil(chars / 4)` approximation, not provider billing tokens.',
    '',
    '| Fixture | Rote chars | Browser Use chars | Rote approx tokens | Browser Use approx tokens | Reduction | Gate |',
    '|---|---:|---:|---:|---:|---:|:---:|',
    ...result.rows.map((row) => (
      `| ${row.id} | ${row.rote_chars} | ${row.browser_use_chars} | ${row.rote_approx_tokens} | ${row.browser_use_approx_tokens} | ${(row.reduction_ratio * 100).toFixed(1)}% | ${row.passed ? 'PASS' : 'FAIL'} |`
    )),
    '',
    `Overall: ${result.passed ? 'PASS' : 'FAIL'} — ${result.total_rote_approx_tokens} vs ${result.total_browser_use_approx_tokens} approximate tokens (${(result.reduction_ratio * 100).toFixed(1)}% reduction).`,
  ];
  return `${lines.join('\n')}\n`;
}

function reductionRatio(rote: number, baseline: number): number {
  if (baseline === 0) return rote === 0 ? 0 : -1;
  return (baseline - rote) / baseline;
}
