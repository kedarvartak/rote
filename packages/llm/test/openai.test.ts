import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAiTaggedLlmClient } from '../src/index.js';

describe('OpenAiTaggedLlmClient', () => {
  it('preserves stable/volatile prompt layout and source-tagged usage', async () => {
    const create = vi.fn(async () => ({
      output_text: '  {"kind":"done","success":true,"summary":"ok"}  ',
      usage: { input_tokens: 123, output_tokens: 17 },
    }));
    const client = new OpenAiTaggedLlmClient({
      model: 'gpt-test',
      client: { responses: { create } } as unknown as OpenAI,
    });

    const result = await client.complete({
      source: 'planner',
      stablePrefix: 'stable action schema',
      volatileSuffix: 'current observation',
      maxTokens: 200,
    });

    expect(create).toHaveBeenCalledWith({
      model: 'gpt-test',
      instructions: 'stable action schema',
      input: 'current observation',
      max_output_tokens: 200,
    });
    expect(result).toEqual({
      text: '{"kind":"done","success":true,"summary":"ok"}',
      // Normalized shape (#57): an uncached call reports its cache buckets as a
      // measured 0, not as an absent field.
      usage: { source: 'planner', input_tokens: 123, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 17 },
    });
  });

  it('fails before a provider call when no OpenAI key is configured', () => {
    expect(() => new OpenAiTaggedLlmClient({ apiKey: '' })).toThrow('OPENAI_API_KEY');
  });
});
