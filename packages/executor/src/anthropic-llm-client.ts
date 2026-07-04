import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from './llm-client.js';

export interface AnthropicLlmClientConfig {
  /** Defaults to `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /**
   * Defaults to `claude-opus-4-8`. Docs/02-architecture.md's "can be a
   * cheap model" is a design aspiration for later cost-tuning (e.g. the
   * M3 bench harness comparing models), not a default this client should
   * make on its own — only an explicit override changes it.
   */
  model?: string;
}

/**
 * The real LLM boundary for slot fills and judgment classifications.
 * Source-tagging (CLAUDE.md "every LLM call is tagged") happens at the
 * call site in executor.ts, which already attributes each completion's
 * usage to `slot` or `judgment` before this client is ever invoked.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: AnthropicLlmClientConfig = {}) {
    const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'AnthropicLlmClient requires an API key: pass config.apiKey or set ANTHROPIC_API_KEY. ' +
          'A playbook with no slot/judgment steps never constructs this client.',
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = config.model ?? 'claude-opus-4-8';
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    // Judgment steps constrain output to a closed set client-side (the
    // executor throws JudgmentOutOfEnumError on a miss) — the prompt
    // addendum below is a hint to the model, not the enforcement point.
    const prompt = request.options
      ? `${request.prompt}\n\nRespond with exactly one of the following options and nothing else: ${request.options.join(', ')}`
      : request.prompt;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    return {
      text: (textBlock?.text ?? '').trim(),
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
