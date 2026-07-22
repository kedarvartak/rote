import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCurveCachePreflight, parseCurveStepJsonl } from '../src/index.js';

const exploratory = fileURLToPath(new URL('../../../docs/testing/data/T3-rote-openai-exploratory.jsonl', import.meta.url));

describe('OpenAI curve cache preflight', () => {
  it('derives the go decision and sparse hit rate from raw T3 calls', async () => {
    const result = buildCurveCachePreflight(parseCurveStepJsonl(await readFile(exploratory, 'utf8')));

    expect(result).toEqual({
      threshold_tokens: 1024,
      measurement_calls: 86,
      prompt_tokens: { min: 539, median: 806, max: 21433 },
      eligible_calls: 26,
      cache_hit_calls: 2,
      cache_hit_rate_all_calls: 2 / 86,
      cache_hit_rate_eligible_calls: 2 / 26,
      cache_read_tokens: 39552,
      decision: 'go-layout-work',
      layout_qualified: false,
    });
  });

  it('stops when every measured prompt is below the configured threshold', async () => {
    const records = parseCurveStepJsonl(await readFile(exploratory, 'utf8'));
    expect(buildCurveCachePreflight(records, 100_000)).toEqual(expect.objectContaining({
      eligible_calls: 0,
      decision: 'stop-below-threshold',
      layout_qualified: false,
    }));
  });
});
