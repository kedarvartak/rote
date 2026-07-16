import Anthropic from '@anthropic-ai/sdk';
import type { TokenUsage, TokenUsageSource } from '@rote/core';
import { TokenAccountingError, type TaggedLlmClient, type TaggedLlmRequest, type TaggedLlmResponse } from './types.js';

/**
 * Normalizes Anthropic's usage into Rote's provider-neutral `TokenUsage` (#57).
 *
 * Anthropic's `input_tokens` **excludes** cache activity — `cache_read_input_tokens`
 * and `cache_creation_input_tokens` are siblings, not a breakdown — so the true
 * prompt size is the sum of all three and `input_tokens` maps straight through as
 * the uncached remainder. This is the exact opposite of OpenAI (see `openai.ts`),
 * and reading only `input_tokens` on both is the bug #57 exists to fix.
 *
 * Exported for the property tests, which assert the normalization contract against
 * generated usage payloads rather than trusting this comment.
 */
export function normalizeAnthropicUsage(source: TokenUsageSource, usage: Anthropic.Usage): TokenUsage {
  // INVARIANT: we only ever request the default 5-minute TTL, which bills cache
  // writes at 1.25x base. A 1-hour write bills at 2x, so folding one into the same
  // bucket would silently under-report cost. If it ever appears, something asked for
  // a TTL we do not price — fail loudly rather than bill it as if it were cheaper.
  const oneHourWrite = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  if (oneHourWrite > 0) {
    throw new TokenAccountingError(
      'anthropic',
      `response reports ${oneHourWrite} tokens written to a 1-hour cache entry, which bills at 2x base rather than the 5-minute 1.25x this client prices`,
      usage,
    );
  }
  return {
    source,
    input_tokens: usage.input_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    output_tokens: usage.output_tokens,
  };
}

export interface AnthropicTaggedLlmClientOptions {
  /** Defaults to `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Model used for tagged completions. */
  model?: string;
}

/** Anthropic implementation of Rote's shared source-tagged LLM boundary. */
export class AnthropicTaggedLlmClient implements TaggedLlmClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicTaggedLlmClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('AnthropicTaggedLlmClient requires apiKey or ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? 'claude-sonnet-4-6';
  }

  async complete(request: TaggedLlmRequest): Promise<TaggedLlmResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 512,
      system: request.stablePrefix,
      messages: [{ role: 'user', content: request.volatileSuffix }],
    });
    const text = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text ?? '';
    return { text: text.trim(), usage: normalizeAnthropicUsage(request.source, response.usage) };
  }
}
