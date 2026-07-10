import { describe, expect, it } from 'vitest';
import type { TaggedLlmClient, TaggedLlmRequest } from '@rote/llm';
import { BrowserPlannerOutputError, TaggedLlmBrowserPlanner, type BrowserPlannerRequest } from '../src/index.js';

class FakeTaggedClient implements TaggedLlmClient {
  requests: TaggedLlmRequest[] = [];

  constructor(private readonly text: string) {}

  async complete(request: TaggedLlmRequest) {
    this.requests.push(request);
    return {
      text: this.text,
      usage: { source: request.source, input_tokens: 42, output_tokens: 8 },
    };
  }
}

describe('TaggedLlmBrowserPlanner', () => {
  it('sends split context through the tagged client and parses an action', async () => {
    const client = new FakeTaggedClient('{"kind":"click","selector":"#submit"}');
    const planner = new TaggedLlmBrowserPlanner(client);

    const response = await planner.plan('planner', request());

    expect(response).toEqual({
      action: { kind: 'click', selector: '#submit' },
      usage: { source: 'planner', input_tokens: 42, output_tokens: 8 },
    });
    expect(client.requests).toEqual([{
      source: 'planner',
      stablePrefix: 'stable instructions',
      volatileSuffix: 'volatile observation',
      maxTokens: 256,
    }]);
  });

  it('rejects malformed output instead of guessing an action', async () => {
    const planner = new TaggedLlmBrowserPlanner(new FakeTaggedClient('click submit'));

    await expect(planner.plan('planner', request())).rejects.toBeInstanceOf(BrowserPlannerOutputError);
  });

  it('rejects JSON outside the closed browser action schema', async () => {
    const planner = new TaggedLlmBrowserPlanner(new FakeTaggedClient('{"kind":"click","selector":""}'));

    await expect(planner.plan('planner', request())).rejects.toBeInstanceOf(BrowserPlannerOutputError);
  });
});

function request(): BrowserPlannerRequest {
  return {
    task: 'Submit the form',
    step: 0,
    page: { url: 'https://portal.test', title: 'Portal' },
    observation: { text: 'button selector=#submit', truncated: false, approxTokens: 5 },
    previousActions: [],
    context: { stablePrefix: 'stable instructions', volatileSuffix: 'volatile observation' },
  };
}
