import OpenAI from 'openai';
import type { TokenUsage, TokenUsageSource } from '@rote/core';
import { TokenAccountingError, type TaggedLlmClient, type TaggedLlmRequest, type TaggedLlmResponse } from './types.js';

/**
 * Normalizes OpenAI's usage into Rote's provider-neutral `TokenUsage` (#57).
 *
 * **OpenAI is the mirror image of Anthropic.** Here `usage.input_tokens` is the
 * *inclusive* total and `input_tokens_details` is a breakdown of it, so the
 * uncached remainder must be derived by subtraction. On Anthropic the same field
 * name means the remainder already. Reading `input_tokens` from both and calling
 * them the same number is the bug.
 *
 * Exported for the property tests, which assert the normalization contract.
 */
export function normalizeOpenAiUsage(source: TokenUsageSource, usage: OpenAI.Responses.ResponseUsage | undefined): TokenUsage {
  if (!usage) {
    // INVARIANT: no usage is not zero usage. A run that reports 0 tokens it never
    // measured is a fabricated number in a benchmark whose headline is tokens.
    throw new TokenAccountingError('openai', 'response carried no usage object, so this call cannot be accounted', usage);
  }
  const cacheRead = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens ?? 0;
  const uncached = usage.input_tokens - cacheRead - cacheWrite;
  // The subtraction assumes both detail fields are disjoint subsets of the
  // inclusive `input_tokens`. A negative remainder disproves that assumption, so
  // fail loudly here rather than silently publish an under-count.
  if (uncached < 0) {
    throw new TokenAccountingError(
      'openai',
      `cached_tokens (${cacheRead}) + cache_write_tokens (${cacheWrite}) exceed input_tokens (${usage.input_tokens}), so they are not disjoint subsets of it as this client assumes`,
      usage,
    );
  }
  return {
    source,
    input_tokens: uncached,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    output_tokens: usage.output_tokens,
  };
}

export interface OpenAiTaggedLlmClientOptions {
  /** Defaults to `OPENAI_API_KEY`. */
  apiKey?: string;
  /** Defaults to `gpt-4.1-mini`. */
  model?: string;
  /** Injectable SDK client for deterministic tests. */
  client?: OpenAI;
}

/** OpenAI Responses API implementation of Rote's shared source-tagged LLM boundary. */
export class OpenAiTaggedLlmClient implements TaggedLlmClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiTaggedLlmClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!options.client && !apiKey) throw new Error('OpenAiTaggedLlmClient requires apiKey or OPENAI_API_KEY');
    this.client = options.client ?? new OpenAI({ apiKey });
    this.model = options.model ?? 'gpt-4.1-mini';
  }

  async complete(request: TaggedLlmRequest): Promise<TaggedLlmResponse> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: request.stablePrefix,
      input: request.volatileSuffix,
      max_output_tokens: request.maxTokens ?? 512,
    });
    return { text: response.output_text.trim(), usage: normalizeOpenAiUsage(request.source, response.usage) };
  }
}
