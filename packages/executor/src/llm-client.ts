import type { TokenUsage, TokenUsageSource } from '@rote/core';

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
  /**
   * Provider-normalized usage minus its `source` (the executor tags each call at
   * the push site). Derived from `TokenUsage` rather than re-declared so the cache
   * buckets cannot be dropped in transit — this adapter previously re-projected
   * `{input_tokens, output_tokens}` by hand and silently discarded cache
   * accounting on the way through (#57).
   */
  usage: Omit<TokenUsage, 'source'>;
}

/** Injected LLM boundary for slot fills and judgment classifications. */
export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
