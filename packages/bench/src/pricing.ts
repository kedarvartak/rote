import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Model prices for the head-to-head's $-per-task column (docs/05 W5 G1 report).
 *
 * Prices are data, not logic: they change without notice, so the table is dated
 * and overridable (`rote-bench headhead --prices <file>`) rather than compiled
 * into the accounting. An unpriced model is reported as unpriced — never as $0,
 * which would silently read as "free" in the launch table.
 */
export const ModelPriceSchema = z.object({
  /** USD per 1M input tokens. */
  input_usd_per_mtok: z.number().nonnegative(),
  /** USD per 1M output tokens. */
  output_usd_per_mtok: z.number().nonnegative(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const PriceTableSchema = z.object({
  /** Date the prices were captured (ISO date), published with the report. */
  version: z.string().min(1),
  source: z.string().min(1),
  prices: z.record(z.string(), ModelPriceSchema),
});
export type PriceTable = z.infer<typeof PriceTableSchema>;

const ANTHROPIC_SOURCE = 'https://platform.claude.com/docs/en/about-claude/models/overview';
const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/pricing';

/**
 * Prices as published on 2026-07-15. Cache reads/writes bill at different rates;
 * these are the base per-token rates, which is why a record's `cache_adjusted`
 * flag has to be read alongside any $ figure (docs/03 fairness rules).
 *
 * Note: `claude-sonnet-5` carries an introductory rate ($2/$10 per MTok) through
 * 2026-08-31. The list price is recorded here so a published number stays true
 * after the promo lapses; pass `--prices` to report actual billed cost instead.
 * When both harnesses run the same model, the *reduction* is unaffected either
 * way — only the absolute $/task moves.
 */
export const DEFAULT_PRICE_TABLE: PriceTable = PriceTableSchema.parse({
  version: '2026-07-15',
  source: `${ANTHROPIC_SOURCE} + ${OPENAI_SOURCE}`,
  prices: {
    // Anthropic — platform.claude.com model overview.
    'claude-fable-5': { input_usd_per_mtok: 10, output_usd_per_mtok: 50 },
    'claude-mythos-5': { input_usd_per_mtok: 10, output_usd_per_mtok: 50 },
    'claude-opus-4-8': { input_usd_per_mtok: 5, output_usd_per_mtok: 25 },
    'claude-opus-4-7': { input_usd_per_mtok: 5, output_usd_per_mtok: 25 },
    'claude-opus-4-6': { input_usd_per_mtok: 5, output_usd_per_mtok: 25 },
    'claude-sonnet-5': { input_usd_per_mtok: 3, output_usd_per_mtok: 15 },
    'claude-sonnet-4-6': { input_usd_per_mtok: 3, output_usd_per_mtok: 15 },
    'claude-haiku-4-5': { input_usd_per_mtok: 1, output_usd_per_mtok: 5 },

    // OpenAI — developers.openai.com pricing. `gpt-5.6` is the documented alias
    // for `gpt-5.6-sol`; both are listed so a record using either is priced.
    'gpt-5.6': { input_usd_per_mtok: 5, output_usd_per_mtok: 30 },
    'gpt-5.6-sol': { input_usd_per_mtok: 5, output_usd_per_mtok: 30 },
    'gpt-5.6-terra': { input_usd_per_mtok: 2.5, output_usd_per_mtok: 15 },
    'gpt-5.6-luna': { input_usd_per_mtok: 1, output_usd_per_mtok: 6 },
    'gpt-5.5': { input_usd_per_mtok: 5, output_usd_per_mtok: 30 },
    'gpt-5.5-pro': { input_usd_per_mtok: 30, output_usd_per_mtok: 180 },
    'gpt-5.4': { input_usd_per_mtok: 2.5, output_usd_per_mtok: 15 },
    'gpt-5.4-mini': { input_usd_per_mtok: 0.75, output_usd_per_mtok: 4.5 },
    'gpt-5.4-nano': { input_usd_per_mtok: 0.2, output_usd_per_mtok: 1.25 },
    'gpt-5.4-pro': { input_usd_per_mtok: 30, output_usd_per_mtok: 180 },
    'gpt-5.3-codex': { input_usd_per_mtok: 1.75, output_usd_per_mtok: 14 },
    // The `@rote/llm` OpenAI default. Not on the pricing page's headline table,
    // but its model page prices it and OpenAI's deprecations page lists no
    // shutdown date, so it is a live model a benchmark run can legitimately use.
    'gpt-4.1-mini': { input_usd_per_mtok: 0.4, output_usd_per_mtok: 1.6 },
  },
});

/** Looks up a model's price, or `undefined` when the table does not price it. */
export function priceForModel(model: string, table: PriceTable = DEFAULT_PRICE_TABLE): ModelPrice | undefined {
  return table.prices[model];
}

/** USD cost of one run's tokens at the given price. Pure. */
export function runCostUsd(inputTokens: number, outputTokens: number, price: ModelPrice): number {
  return (inputTokens * price.input_usd_per_mtok + outputTokens * price.output_usd_per_mtok) / 1_000_000;
}

/** Loads and validates a price table override file. */
export async function readPriceTable(path: string): Promise<PriceTable> {
  return PriceTableSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
}
