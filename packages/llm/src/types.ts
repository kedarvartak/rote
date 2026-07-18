import type { TokenUsage, TokenUsageSource } from '@rote/core';

export interface TaggedLlmRequest {
  source: TokenUsageSource;
  stablePrefix: string;
  volatileSuffix: string;
  maxTokens?: number;
}

/** Provider identity and unmodified usage payload retained for benchmark audit. */
export interface ProviderUsageReceipt {
  provider: 'anthropic' | 'openai';
  model: string;
  usage: Record<string, unknown>;
}

export interface TaggedLlmResponse {
  text: string;
  usage: TokenUsage;
  /** Present for real provider calls; injectable fixture clients may omit it. */
  providerReceipt?: ProviderUsageReceipt;
}

/** Shared LLM boundary; every request carries its benchmark-accounting source. */
export interface TaggedLlmClient {
  complete(request: TaggedLlmRequest): Promise<TaggedLlmResponse>;
}

/**
 * Raised when a provider's usage payload cannot be normalized into `TokenUsage`.
 *
 * INVARIANT: unaccountable usage is an error, never a silent zero (#57). A
 * benchmark whose headline is a token count cannot guess at token counts — the
 * same rule the Browser Use runner's `usage_from_history` already enforces on
 * the competitor side.
 */
export class TokenAccountingError extends Error {
  constructor(
    readonly provider: 'anthropic' | 'openai',
    reason: string,
    readonly usage: unknown,
  ) {
    super(`${provider}: ${reason}. Teach the ${provider} client this usage shape — do not default to 0.`);
    this.name = 'TokenAccountingError';
  }
}
