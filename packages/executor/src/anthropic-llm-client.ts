import { AnthropicTaggedLlmClient } from '@rote/llm';
import { TaggedExecutorLlmClient } from './tagged-llm-client.js';

export interface AnthropicLlmClientConfig {
  /** Defaults to `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Defaults to the shared Anthropic client's model. */
  model?: string;
}

/** Explicit Anthropic executor adapter retained for opt-in compatibility. */
export class AnthropicLlmClient extends TaggedExecutorLlmClient {
  constructor(config: AnthropicLlmClientConfig = {}) {
    super(new AnthropicTaggedLlmClient(config));
  }
}
