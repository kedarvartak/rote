import { describe, expect, it } from 'vitest';
import type { TaggedLlmClient, TaggedLlmRequest } from '@rote/llm';
import { BrowserPlannerOutputError, TaggedLlmBrowserPlanner, type BrowserPlannerRequest } from '../src/index.js';

class FakeTaggedClient implements TaggedLlmClient {
  requests: TaggedLlmRequest[] = [];

  private index = 0;

  constructor(private readonly texts: string | readonly string[]) {}

  async complete(request: TaggedLlmRequest) {
    this.requests.push(request);
    const values = typeof this.texts === 'string' ? [this.texts] : this.texts;
    const text = values[Math.min(this.index, values.length - 1)]!;
    this.index += 1;
    return {
      text,
      usage: { source: request.source, input_tokens: 42, output_tokens: 8 },
    };
  }
}

describe('TaggedLlmBrowserPlanner', () => {
  it('sends split context through the tagged client and parses an action', async () => {
    const client = new FakeTaggedClient('{"kind":"click","selector":"#submit","expect":{"selector_visible":"#submit"}}');
    const planner = new TaggedLlmBrowserPlanner(client);

    const response = await planner.plan('planner', request());

    expect(response).toEqual({
      action: { kind: 'click', selector: '#submit', expect: { selector_visible: '#submit' } },
      usage: { source: 'planner', input_tokens: 42, output_tokens: 8 },
    });
    expect(client.requests).toEqual([{
      source: 'planner',
      stablePrefix: 'stable instructions',
      volatileSuffix: 'volatile observation',
      maxTokens: 256,
    }]);
  });

  it('repairs one malformed completion with narrow validation context', async () => {
    const client = new FakeTaggedClient([
      'click submit',
      '{"kind":"click","selector":"#submit"}',
    ]);
    const planner = new TaggedLlmBrowserPlanner(client);

    const response = await planner.plan('planner', request());

    expect(response).toEqual({
      action: { kind: 'click', selector: '#submit' },
      usage: { source: 'planner', input_tokens: 42, output_tokens: 8 },
      repairUsage: [{ source: 'repair', input_tokens: 42, output_tokens: 8 }],
    });
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]).toEqual(expect.objectContaining({ source: 'repair' }));
    expect(client.requests[1]?.volatileSuffix).toContain('browser planner returned invalid JSON');
    expect(client.requests[1]?.volatileSuffix).toContain('click submit');
  });

  it('fails closed with all usage when the repair budget is exhausted', async () => {
    const planner = new TaggedLlmBrowserPlanner(new FakeTaggedClient('{"kind":"click","selector":""}'));

    const failure = await planner.plan('planner', request()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BrowserPlannerOutputError);
    expect((failure as BrowserPlannerOutputError).usages.map((usage) => usage.source)).toEqual(['planner', 'repair']);
  });
});

function request(): BrowserPlannerRequest {
  return {
    task: 'Submit the form',
    step: 0,
    page: { url: 'https://portal.test', title: 'Portal' },
    observation: { text: 'button selector=#submit', truncated: false, approxTokens: 5, mode: 'full' },
    previousActions: [],
    context: { stablePrefix: 'stable instructions', volatileSuffix: 'volatile observation' },
  };
}
