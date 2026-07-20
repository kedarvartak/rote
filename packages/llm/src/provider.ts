import { AnthropicTaggedLlmClient } from './anthropic.js';
import { OpenAiTaggedLlmClient } from './openai.js';
import type { TaggedLlmClient } from './types.js';

export type LlmProvider = 'anthropic' | 'openai';

export interface TaggedLlmProviderOptions {
  /** Defaults to `ROTE_LLM_PROVIDER`, then OpenAI for the executable P1 path. */
  provider?: string;
  model?: string;
  /** Injectable environment for deterministic configuration tests. */
  env?: Record<string, string | undefined>;
}

/** Creates the configured provider client from `ROTE_LLM_PROVIDER`. */
export function createTaggedLlmClientFromEnv(
  options: TaggedLlmProviderOptions = {},
): TaggedLlmClient {
  const env = options.env ?? process.env;
  const provider = options.provider ?? env['ROTE_LLM_PROVIDER'] ?? 'openai';
  if (provider === 'openai') {
    return new OpenAiTaggedLlmClient({ apiKey: env['OPENAI_API_KEY'], model: options.model });
  }
  if (provider === 'anthropic') {
    return new AnthropicTaggedLlmClient({ apiKey: env['ANTHROPIC_API_KEY'], model: options.model });
  }
  throw new Error(`ROTE_LLM_PROVIDER must be "openai" or "anthropic", got ${JSON.stringify(provider)}`);
}
