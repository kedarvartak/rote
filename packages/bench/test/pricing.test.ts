import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_TABLE,
  PriceTableSchema,
  priceForModel,
  readPriceTable,
  runCostUsd,
} from '../src/pricing.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('DEFAULT_PRICE_TABLE', () => {
  it('is a valid, dated, sourced table', () => {
    expect(() => PriceTableSchema.parse(DEFAULT_PRICE_TABLE)).not.toThrow();
    expect(DEFAULT_PRICE_TABLE.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEFAULT_PRICE_TABLE.source).toContain('http');
  });

  it('prices the models both harnesses can actually be pointed at', () => {
    // The benchmark is runnable on either provider (docs/03 requires only that
    // both harnesses use the *same* model), so both must be priced or the $
    // column silently drops out for whichever key the operator happens to have.
    for (const model of ['claude-opus-4-8', 'gpt-5.6-sol', 'gpt-4.1-mini']) {
      expect(priceForModel(model), `${model} is unpriced`).toBeDefined();
    }
  });

  it('prices output tokens at or above input tokens for every model', () => {
    // Not a law of nature, but true of every provider we price; a table where
    // this flipped would almost certainly be a transcription error.
    for (const [model, price] of Object.entries(DEFAULT_PRICE_TABLE.prices)) {
      expect(price.output_usd_per_mtok, model).toBeGreaterThanOrEqual(price.input_usd_per_mtok);
      expect(price.input_usd_per_mtok, model).toBeGreaterThan(0);
    }
  });
});

describe('runCostUsd', () => {
  it('bills input and output at their own per-1M rates', () => {
    // gpt-4.1-mini: $0.40/MTok in, $1.60/MTok out.
    const price = priceForModel('gpt-4.1-mini');
    expect(price).toBeDefined();
    expect(runCostUsd(1_000_000, 0, price!)).toBeCloseTo(0.4, 10);
    expect(runCostUsd(0, 1_000_000, price!)).toBeCloseTo(1.6, 10);
    expect(runCostUsd(500_000, 500_000, price!)).toBeCloseTo(1.0, 10);
    // GPT-4.1 mini's published cached-input rate is $0.10/MTok, not the
    // generic 0.1x fallback used only when a model-specific rate is absent.
    expect(runCostUsd(0, 0, price!, 1_000_000)).toBeCloseTo(0.1, 10);
  });

  it('costs nothing for a run that spent no tokens', () => {
    expect(runCostUsd(0, 0, { input_usd_per_mtok: 5, output_usd_per_mtok: 25 })).toBe(0);
  });
});

describe('priceForModel', () => {
  it('returns undefined for an unknown model rather than a zero price', () => {
    expect(priceForModel('not-a-real-model')).toBeUndefined();
  });
});

describe('readPriceTable', () => {
  it('loads an override table and rejects a malformed one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rote-prices-'));
    dirs.push(dir);
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    await writeFile(
      good,
      JSON.stringify({
        version: '2026-07-15',
        source: 'https://example.test/prices',
        prices: { 'gpt-5.6-sol': { input_usd_per_mtok: 1, output_usd_per_mtok: 2 } },
      }),
      'utf8',
    );
    // Negative price: a table that pays you per token is a typo, not a discount.
    await writeFile(
      bad,
      JSON.stringify({ version: '1', source: 's', prices: { m: { input_usd_per_mtok: -1, output_usd_per_mtok: 2 } } }),
      'utf8',
    );

    const table = await readPriceTable(good);
    expect(priceForModel('gpt-5.6-sol', table)?.input_usd_per_mtok).toBe(1);
    await expect(readPriceTable(bad)).rejects.toThrow();
  });
  it('prices cache buckets at their real rates rather than the base input rate (#57)', () => {
    // The real measured OpenAI warm call: 3 uncached + 4024 cache-read + 5 output.
    const price = priceForModel('gpt-5.6-luna')!;
    const warm = runCostUsd(3, 5, price, 4024, 0);

    // What the pre-#57 code did: count every input token at the base rate, because
    // OpenAI's input_tokens (4027) is inclusive and the cache split was never read.
    const naive = runCostUsd(4027, 5, price);

    // Cache reads bill at ~0.1x, so the naive figure overstates this call's input
    // cost by roughly 10x on the cached portion. Both are non-zero; the gap is the bug.
    expect(warm).toBeLessThan(naive);
    expect(naive / warm).toBeGreaterThan(5);
  });

  it('prices an Anthropic cache write above base and a read below it', () => {
    const price = priceForModel('claude-opus-4-8')!;
    const base = runCostUsd(1_000_000, 0, price);
    const write = runCostUsd(0, 0, price, 0, 1_000_000);
    const read = runCostUsd(0, 0, price, 1_000_000, 0);

    // Published multipliers: writes 1.25x base (5-minute TTL), reads ~0.1x.
    expect(write).toBeCloseTo(base * 1.25, 6);
    expect(read).toBeCloseTo(base * 0.1, 6);
  });
});
