import { spawn } from 'node:child_process';
import type { TokenUsage, TokenUsageSource } from '@rote/core';
import { TokenAccountingError, type TaggedLlmClient, type TaggedLlmRequest, type TaggedLlmResponse } from './types.js';

export type SubscriptionCliProvider = 'claude-code' | 'codex';

export interface SubscriptionCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type SubscriptionCliRunner = (command: string, args: readonly string[]) => Promise<SubscriptionCliResult>;

/** Runs a signed-in local CLI without passing credentials through Rote. */
export const runSubscriptionCli: SubscriptionCliRunner = async (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.on('error', (error) => reject(new Error(`could not start ${command}: ${error.message}`)));
  child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
});

export interface SubscriptionCliTaggedLlmClientOptions {
  provider: SubscriptionCliProvider;
  model?: string;
  command?: string;
  runner?: SubscriptionCliRunner;
}

/**
 * Planner client backed by a user's existing Codex or Claude Code login.
 * These CLIs receive a response-only instruction and their JSON output supplies
 * the same per-call token accounting that API clients retain.
 */
export class SubscriptionCliTaggedLlmClient implements TaggedLlmClient {
  private readonly command: string;
  private readonly runner: SubscriptionCliRunner;

  constructor(private readonly options: SubscriptionCliTaggedLlmClientOptions) {
    this.command = options.command ?? (options.provider === 'codex' ? 'codex' : 'claude');
    this.runner = options.runner ?? runSubscriptionCli;
  }

  async complete(request: TaggedLlmRequest): Promise<TaggedLlmResponse> {
    const prompt = `${request.stablePrefix}\n\n${request.volatileSuffix}\n\nReturn only the requested response. Do not use tools, inspect files, or make changes.`;
    const result = await this.runner(this.command, this.args(prompt, request.maxTokens));
    if (result.exitCode !== 0) {
      throw new Error(`${this.options.provider} exited ${result.exitCode}: ${result.stderr.trim() || 'no diagnostic output'}`);
    }
    return this.options.provider === 'codex'
      ? parseCodexResult(request.source, result.stdout, this.options.model ?? 'default')
      : parseClaudeCodeResult(request.source, result.stdout, this.options.model ?? 'default');
  }

  private args(prompt: string, _maxTokens: number | undefined): string[] {
    if (this.options.provider === 'codex') {
      return [
        'exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
        ...(this.options.model ? ['--model', this.options.model] : []), prompt,
      ];
    }
    return [
      '--print', '--output-format', 'json', '--max-turns', '1', '--permission-mode', 'plan',
      ...(this.options.model ? ['--model', this.options.model] : []),
      prompt,
    ];
  }
}

function parseCodexResult(source: TokenUsageSource, stdout: string, model: string): TaggedLlmResponse {
  let text = '';
  let usage: Record<string, unknown> | undefined;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (event.type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === 'agent_message' && typeof item.text === 'string') text = item.text;
    }
    if (event.type === 'turn.completed' && isRecord(event.usage)) usage = event.usage;
  }
  if (!usage) throw new TokenAccountingError('codex', 'CLI JSON did not contain turn.completed usage', stdout);
  return {
    text: text.trim(), usage: normalizeCodexUsage(source, usage),
    providerReceipt: { provider: 'codex', model, usage },
  };
}

function parseClaudeCodeResult(source: TokenUsageSource, stdout: string, model: string): TaggedLlmResponse {
  let response: Record<string, unknown>;
  try { response = JSON.parse(stdout) as Record<string, unknown>; } catch {
    throw new TokenAccountingError('claude-code', 'CLI did not return its documented JSON result', stdout);
  }
  if (response.type !== 'result' || response.is_error === true || typeof response.result !== 'string' || !isRecord(response.usage)) {
    throw new TokenAccountingError('claude-code', 'CLI result was missing a successful response or usage payload', response);
  }
  return {
    text: response.result.trim(), usage: normalizeClaudeCodeUsage(source, response.usage),
    providerReceipt: { provider: 'claude-code', model, usage: response.usage },
  };
}

function normalizeCodexUsage(source: TokenUsageSource, usage: Record<string, unknown>): TokenUsage {
  const input = numberField(usage, 'input_tokens', 'codex');
  const cached = optionalNumberField(usage, 'cached_input_tokens', 'codex');
  const output = numberField(usage, 'output_tokens', 'codex');
  if (cached > input) throw new TokenAccountingError('codex', 'cached_input_tokens exceeds input_tokens', usage);
  return { source, input_tokens: input - cached, cache_read_tokens: cached, cache_write_tokens: 0, output_tokens: output };
}

function normalizeClaudeCodeUsage(source: TokenUsageSource, usage: Record<string, unknown>): TokenUsage {
  return {
    source,
    input_tokens: numberField(usage, 'input_tokens', 'claude-code'),
    cache_read_tokens: optionalNumberField(usage, 'cache_read_input_tokens', 'claude-code'),
    cache_write_tokens: optionalNumberField(usage, 'cache_creation_input_tokens', 'claude-code'),
    output_tokens: numberField(usage, 'output_tokens', 'claude-code'),
  };
}

function numberField(record: Record<string, unknown>, field: string, provider: SubscriptionCliProvider): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TokenAccountingError(provider, `${field} was absent or invalid`, record);
  return value;
}

function optionalNumberField(record: Record<string, unknown>, field: string, provider: SubscriptionCliProvider): number {
  const value = record[field];
  if (value === undefined) return 0;
  return numberField(record, field, provider);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
