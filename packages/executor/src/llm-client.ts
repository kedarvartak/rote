import type { TokenUsageSource } from '@rote/core';

export interface LlmCompletionRequest {
  /** CLAUDE.md "every LLM call is tagged" — untagged usage fails lint elsewhere. */
  source: TokenUsageSource;
  prompt: string;
  maxTokens?: number;
  /** Present for judgment steps: the classification is constrained to one of these. */
  options?: readonly string[];
}

export interface LlmCompletionResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** Injected LLM boundary for slot fills and judgment classifications. */
export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
