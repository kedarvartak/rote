import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from '../../src/llm-client.js';

/** A scriptable fake LLM boundary that logs every request, for asserting call counts. */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmCompletionRequest[] = [];

  constructor(private readonly respond: (request: LlmCompletionRequest, callIndex: number) => LlmCompletionResult) {}

  get callCount(): number {
    return this.requests.length;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const callIndex = this.requests.length;
    this.requests.push(request);
    return this.respond(request, callIndex);
  }
}

export function completion(text: string, usage = { input_tokens: 10, output_tokens: 5 }): LlmCompletionResult {
  return { text, usage };
}
