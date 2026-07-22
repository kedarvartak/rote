import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseCurveStepJsonl, type CurveStepRecord } from './curve-protocol.js';

/** Reproducible OpenAI cache-eligibility and observed-hit summary. */
export interface CurveCachePreflight {
  threshold_tokens: number;
  measurement_calls: number;
  prompt_tokens: { min: number; median: number; max: number };
  eligible_calls: number;
  cache_hit_calls: number;
  cache_hit_rate_all_calls: number;
  cache_hit_rate_eligible_calls: number;
  cache_read_tokens: number;
  decision: 'go-layout-work' | 'stop-below-threshold';
  layout_qualified: boolean;
}

/** Computes cache preflight from provider-normalized measurement calls. */
export function buildCurveCachePreflight(
  records: readonly CurveStepRecord[],
  thresholdTokens = 1024,
): CurveCachePreflight {
  if (!Number.isInteger(thresholdTokens) || thresholdTokens < 1) throw new Error('cache threshold must be a positive integer');
  const measurements = records.filter((record) => record.record_kind === 'measurement');
  if (measurements.length === 0) throw new Error('cache preflight requires measurement records');
  const promptSizes = measurements.map((record) => (
    record.usage.input_tokens + record.usage.cache_read_tokens + record.usage.cache_write_tokens
  )).sort((left, right) => left - right);
  const eligible = measurements.filter((record) => (
    record.usage.input_tokens + record.usage.cache_read_tokens + record.usage.cache_write_tokens >= thresholdTokens
  ));
  const hits = measurements.filter((record) => record.usage.cache_read_tokens > 0);
  return {
    threshold_tokens: thresholdTokens,
    measurement_calls: measurements.length,
    prompt_tokens: {
      min: promptSizes[0]!,
      median: promptSizes[Math.floor(promptSizes.length / 2)]!,
      max: promptSizes.at(-1)!,
    },
    eligible_calls: eligible.length,
    cache_hit_calls: hits.length,
    cache_hit_rate_all_calls: hits.length / measurements.length,
    cache_hit_rate_eligible_calls: eligible.length === 0 ? 0 : hits.length / eligible.length,
    cache_read_tokens: hits.reduce((sum, record) => sum + record.usage.cache_read_tokens, 0),
    decision: eligible.length > 0 ? 'go-layout-work' : 'stop-below-threshold',
    // A layout needs repeatable hits; preflight only proves the provider can hit.
    layout_qualified: false,
  };
}

/** Writes a cache preflight report from validated curve JSONL. */
export async function writeCurveCachePreflight(recordsPath: string, outPath: string, thresholdTokens = 1024): Promise<CurveCachePreflight> {
  const records = parseCurveStepJsonl(await readFile(resolve(recordsPath), 'utf8'));
  const result = buildCurveCachePreflight(records, thresholdTokens);
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}
