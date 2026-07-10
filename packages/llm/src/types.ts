import type { TokenUsage, TokenUsageSource } from '@rote/core';

export interface TaggedLlmRequest {
  source: TokenUsageSource;
  stablePrefix: string;
  volatileSuffix: string;
  maxTokens?: number;
}

export interface TaggedLlmResponse {
  text: string;
  usage: TokenUsage;
}

/** Shared LLM boundary; every request carries its benchmark-accounting source. */
export interface TaggedLlmClient {
  complete(request: TaggedLlmRequest): Promise<TaggedLlmResponse>;
}
