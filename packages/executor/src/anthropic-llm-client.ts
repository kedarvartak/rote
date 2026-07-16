import { AnthropicTaggedLlmClient } from '@rote/llm';
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from './llm-client.js';

export interface AnthropicLlmClientConfig {
  /** Defaults to `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Defaults to the shared Anthropic client's model. */
  model?: string;
}

/** Executor compatibility adapter over Rote's shared tagged LLM client. */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: AnthropicTaggedLlmClient;

  constructor(config: AnthropicLlmClientConfig = {}) {
    this.client = new AnthropicTaggedLlmClient(config);
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const optionInstruction = request.options
      ? `\n\nRespond with exactly one of the following options and nothing else: ${request.options.join(', ')}`
      : '';
    const response = await this.client.complete({
      source: request.source,
      stablePrefix: 'Follow the supplied task exactly and return only the requested value.',
      volatileSuffix: `${request.prompt}${optionInstruction}`,
      maxTokens: request.maxTokens ?? 1024,
    });
    // Pass the normalized usage through whole. Re-projecting named fields here is
    // how the cache buckets got dropped before (#57); the executor re-tags `source`
    // at the push site, so that is the only field this adapter removes.
    const { source: _source, ...usage } = response.usage;
    return { text: response.text, usage };
  }
}
