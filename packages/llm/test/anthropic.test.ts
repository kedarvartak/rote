import { describe, expect, it } from 'vitest';
import { AnthropicTaggedLlmClient } from '../src/index.js';

describe('AnthropicTaggedLlmClient', () => {
  it('fails before any provider call when no API key is configured', () => {
    expect(() => new AnthropicTaggedLlmClient({ apiKey: '' })).toThrow(
      'AnthropicTaggedLlmClient requires apiKey or ANTHROPIC_API_KEY',
    );
  });
});
