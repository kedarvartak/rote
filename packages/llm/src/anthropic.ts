import Anthropic from '@anthropic-ai/sdk';
import type { TaggedLlmClient, TaggedLlmRequest, TaggedLlmResponse } from './types.js';

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
    return {
      text: text.trim(),
      usage: {
        source: request.source,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
