import { createTaggedLlmClientFromEnv, type TaggedLlmClient } from '@rote/llm';
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from './llm-client.js';

/** Executor adapter over the configured shared tagged provider boundary. */
export class TaggedExecutorLlmClient implements LlmClient {
  constructor(private readonly client: TaggedLlmClient = createTaggedLlmClientFromEnv()) {}

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
    // Preserve every normalized cache bucket; the executor reattaches the source
    // at its accounting boundary (#57).
    const { source: _source, ...usage } = response.usage;
    return { text: response.text, usage };
  }
}
