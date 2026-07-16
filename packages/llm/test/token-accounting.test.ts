import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { totalInputTokens } from '@rote/core';
import { normalizeAnthropicUsage, normalizeOpenAiUsage, TokenAccountingError } from '../src/index.js';

/**
 * The normalization contract (#57):
 *
 *   input_tokens + cache_read_tokens + cache_write_tokens === the provider's true total prompt size
 *
 * with `input_tokens` always the uncached remainder. These tests exist because the
 * two providers disagree about what `input_tokens` means, and the old code read
 * that one field from both — so enabling caching would have collapsed Anthropic's
 * reported input and published a token reduction that never happened.
 */

const nonNegative = fc.integer({ min: 0, max: 5_000_000 });

describe('token accounting normalizes both providers onto one contract (#57)', () => {
  it('preserves Anthropic total prompt size, where input_tokens EXCLUDES cache', () => {
    fc.assert(
      fc.property(nonNegative, nonNegative, nonNegative, nonNegative, (uncached, read, write, output) => {
        // Anthropic's fields are siblings: the true prompt size is their sum.
        const usage = {
          input_tokens: uncached,
          output_tokens: output,
          cache_read_input_tokens: read,
          cache_creation_input_tokens: write,
          cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 },
        } as Anthropic.Usage;

        const normalized = normalizeAnthropicUsage('planner', usage);
        expect(totalInputTokens(normalized)).toBe(uncached + read + write);
        expect(normalized.input_tokens).toBe(uncached);
        expect(normalized.cache_read_tokens).toBe(read);
        expect(normalized.cache_write_tokens).toBe(write);
      }),
    );
  });

  it('preserves OpenAI total prompt size, where input_tokens INCLUDES cache', () => {
    fc.assert(
      fc.property(nonNegative, nonNegative, nonNegative, nonNegative, (uncached, read, write, output) => {
        // OpenAI's details are a breakdown of the inclusive total.
        const total = uncached + read + write;
        const usage = {
          input_tokens: total,
          output_tokens: output,
          input_tokens_details: { cached_tokens: read, cache_write_tokens: write },
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: total + output,
        } as OpenAI.Responses.ResponseUsage;

        const normalized = normalizeOpenAiUsage('planner', usage);
        // The invariant that matters: the provider's own total survives normalization.
        expect(totalInputTokens(normalized)).toBe(total);
        expect(normalized.input_tokens).toBe(uncached);
        expect(normalized.cache_read_tokens).toBe(read);
        expect(normalized.cache_write_tokens).toBe(write);
      }),
    );
  });

  it('reports the same normalized total for both providers given the same real usage', () => {
    // The regression this locks down: 1000 uncached + 500 cache reads is the same
    // 1500-token prompt on either provider, and must be reported as such.
    const anthropic = normalizeAnthropicUsage('planner', {
      input_tokens: 1000,
      output_tokens: 50,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    } as Anthropic.Usage);

    const openai = normalizeOpenAiUsage('planner', {
      input_tokens: 1500,
      output_tokens: 50,
      input_tokens_details: { cached_tokens: 500, cache_write_tokens: 0 },
    } as OpenAI.Responses.ResponseUsage);

    expect(totalInputTokens(anthropic)).toBe(1500);
    expect(totalInputTokens(openai)).toBe(1500);
    expect(anthropic).toEqual(openai);
  });

  it('normalizes a real measured OpenAI cold/warm pair to the same prompt size', () => {
    // Captured live on 2026-07-17, gpt-5.6-luna, a ~4k-token prompt sent twice.
    // OpenAI's automatic caching fired with no cache_control at all:
    //   cold: input_tokens=4027 cached=0    cache_write=4024
    //   warm: input_tokens=4027 cached=4024 cache_write=0
    // `input_tokens` is FLAT across both — proving it is the inclusive total and
    // the details are disjoint subsets, which is what the subtraction relies on.
    const cold = normalizeOpenAiUsage('planner', {
      input_tokens: 4027,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 4024 },
    } as OpenAI.Responses.ResponseUsage);
    const warm = normalizeOpenAiUsage('planner', {
      input_tokens: 4027,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 4024, cache_write_tokens: 0 },
    } as OpenAI.Responses.ResponseUsage);

    expect(totalInputTokens(cold)).toBe(4027);
    expect(totalInputTokens(warm)).toBe(4027);
    // The uncached remainder is the same 3 tokens either way — only the bucket moves.
    expect(cold.input_tokens).toBe(3);
    expect(warm.input_tokens).toBe(3);
    expect(cold.cache_write_tokens).toBe(4024);
    expect(warm.cache_read_tokens).toBe(4024);
  });

  it('a caching change never looks like a token reduction', () => {
    // The same 2000-token prompt, uncached then fully cache-hit. Under the old
    // code Anthropic's reported input_tokens would fall 2000 -> 0 and read as a
    // 100% efficiency win. The normalized total must not move.
    const cold = normalizeAnthropicUsage('planner', {
      input_tokens: 2000,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    } as Anthropic.Usage);
    const warm = normalizeAnthropicUsage('planner', {
      input_tokens: 0,
      output_tokens: 10,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    } as Anthropic.Usage);

    expect(totalInputTokens(cold)).toBe(totalInputTokens(warm));
    // Only the split moves — which is the real, honest saving (cache reads bill ~0.1x).
    expect(warm.cache_read_tokens).toBe(2000);
    expect(warm.input_tokens).toBe(0);
  });
});

describe('unaccountable usage is an error, never a silent zero (#57)', () => {
  it('rejects an OpenAI response with no usage object rather than reporting 0 tokens', () => {
    expect(() => normalizeOpenAiUsage('planner', undefined)).toThrow(TokenAccountingError);
    expect(() => normalizeOpenAiUsage('planner', undefined)).toThrow(/cannot be accounted/);
  });

  it('rejects OpenAI details that are not subsets of the inclusive total', () => {
    // If OpenAI ever changed cached_tokens to be a sibling rather than a subset,
    // subtraction would silently under-count. It must fail instead.
    const usage = {
      input_tokens: 100,
      output_tokens: 10,
      input_tokens_details: { cached_tokens: 400, cache_write_tokens: 0 },
    } as OpenAI.Responses.ResponseUsage;
    expect(() => normalizeOpenAiUsage('planner', usage)).toThrow(/not disjoint subsets/);
  });

  it('refuses to price an Anthropic 1-hour cache write as if it were a 5-minute one', () => {
    // 1h writes bill at 2x base; 5m at 1.25x. We never request 1h, so seeing one
    // means an unpriced TTL — cheaper-by-default would understate cost.
    const usage = {
      input_tokens: 10,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 800,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 800 },
    } as Anthropic.Usage;
    expect(() => normalizeAnthropicUsage('planner', usage)).toThrow(/1-hour cache entry/);
  });

  it('treats Anthropic null cache fields as genuinely zero, not as missing data', () => {
    // Anthropic types these nullable; null means "no caching happened", which is
    // a real 0 rather than an unreadable field.
    const normalized = normalizeAnthropicUsage('planner', {
      input_tokens: 42,
      output_tokens: 7,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      cache_creation: null,
    } as Anthropic.Usage);
    expect(normalized).toEqual({
      source: 'planner',
      input_tokens: 42,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 7,
    });
  });
});
