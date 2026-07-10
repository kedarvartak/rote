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
    return {
      text: response.text,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
