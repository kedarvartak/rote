import OpenAI from 'openai';
import type { TaggedLlmClient, TaggedLlmRequest, TaggedLlmResponse } from './types.js';

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
    return {
      text: response.output_text.trim(),
      usage: {
        source: request.source,
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      },
    };
  }
}
