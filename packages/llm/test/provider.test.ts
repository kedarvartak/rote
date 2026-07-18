import { describe, expect, it } from 'vitest';
import {
  AnthropicTaggedLlmClient,
  createTaggedLlmClientFromEnv,
  OpenAiTaggedLlmClient,
} from '../src/index.js';

describe('createTaggedLlmClientFromEnv', () => {
  it('selects OpenAI from ROTE_LLM_PROVIDER', () => {
    const client = createTaggedLlmClientFromEnv({
      env: { ROTE_LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-openai-key' },
    });

    expect(client).toBeInstanceOf(OpenAiTaggedLlmClient);
  });

  it('uses OpenAI by default while keeping Anthropic explicitly selectable', () => {
    expect(createTaggedLlmClientFromEnv({
      env: { OPENAI_API_KEY: 'test-openai-key' },
    })).toBeInstanceOf(OpenAiTaggedLlmClient);
    expect(createTaggedLlmClientFromEnv({
      env: { ROTE_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-anthropic-key' },
    })).toBeInstanceOf(AnthropicTaggedLlmClient);
  });

  it('rejects an unsupported provider before any network request', () => {
    expect(() => createTaggedLlmClientFromEnv({
      env: { ROTE_LLM_PROVIDER: 'other' },
    })).toThrow('ROTE_LLM_PROVIDER must be "openai" or "anthropic"');
  });

  it('requires the key for the selected provider only', () => {
    expect(() => createTaggedLlmClientFromEnv({
      env: { ROTE_LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'irrelevant' },
    })).toThrow('OPENAI_API_KEY');
  });
});
