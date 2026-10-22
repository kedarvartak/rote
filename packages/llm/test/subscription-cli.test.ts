import { describe, expect, it } from 'vitest';
import { SubscriptionCliTaggedLlmClient } from '../src/index.js';

describe('subscription CLI clients', () => {
  it('uses a signed-in Codex command and records its JSONL usage', async () => {
    const runner = async (command: string, args: readonly string[]) => {
      expect(command).toBe('codex');
      expect(args).toContain('--json');
      expect(args).toContain('--sandbox');
      return {
        exitCode: 0, stderr: '', stdout: [
          '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"action\\":\\"click\\"}"}}',
          '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":12}}',
        ].join('\n'),
      };
    };
    const result = await new SubscriptionCliTaggedLlmClient({ provider: 'codex', runner }).complete({
      source: 'planner', stablePrefix: 'stable', volatileSuffix: 'volatile',
    });
    expect(result.text).toBe('{"action":"click"}');
    expect(result.usage).toMatchObject({ input_tokens: 60, cache_read_tokens: 40, output_tokens: 12 });
    expect(result.providerReceipt?.provider).toBe('codex');
  });

  it('uses Claude Code JSON and preserves its cache buckets', async () => {
    const runner = async (command: string, args: readonly string[]) => {
      expect(command).toBe('claude');
      expect(args).toContain('--print');
      return {
        exitCode: 0, stderr: '', stdout: JSON.stringify({
          type: 'result', is_error: false, result: '{"action":"fill"}',
          usage: { input_tokens: 8, cache_read_input_tokens: 12, cache_creation_input_tokens: 20, output_tokens: 6 },
        }),
      };
    };
    const result = await new SubscriptionCliTaggedLlmClient({ provider: 'claude-code', runner }).complete({
      source: 'planner', stablePrefix: 'stable', volatileSuffix: 'volatile',
    });
    expect(result.usage).toMatchObject({ input_tokens: 8, cache_read_tokens: 12, cache_write_tokens: 20, output_tokens: 6 });
    expect(result.providerReceipt?.provider).toBe('claude-code');
  });
});
