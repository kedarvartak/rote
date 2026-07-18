import { describe, expect, it, vi } from 'vitest';
import type { TaggedLlmClient, TaggedLlmRequest } from '@rote/llm';
import { TaggedExecutorLlmClient } from '../src/index.js';

describe('TaggedExecutorLlmClient', () => {
  it('uses the shared provider boundary and preserves normalized cache buckets', async () => {
    const complete = vi.fn(async (request: TaggedLlmRequest) => ({
      text: 'approve',
      usage: {
        source: request.source,
        input_tokens: 100,
        cache_read_tokens: 900,
        cache_write_tokens: 0,
        output_tokens: 4,
      },
    }));
    const client = new TaggedExecutorLlmClient({ complete } as TaggedLlmClient);

    await expect(client.complete({
      source: 'judgment',
      prompt: 'Classify this request',
      options: ['approve', 'reject'],
      maxTokens: 8,
    })).resolves.toEqual({
      text: 'approve',
      usage: { input_tokens: 100, cache_read_tokens: 900, cache_write_tokens: 0, output_tokens: 4 },
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      source: 'judgment',
      maxTokens: 8,
      volatileSuffix: expect.stringContaining('approve, reject'),
    }));
  });
});
