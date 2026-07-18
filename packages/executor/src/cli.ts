import { readFileSync } from 'node:fs';
import { buildEnvFingerprint, parsePlaybookYaml, type ParamBindings } from '@rote/core';
import { TaggedExecutorLlmClient } from './tagged-llm-client.js';
import { runPlaybook } from './executor.js';
import type { LlmClient } from './llm-client.js';
import { McpToolCaller } from './mcp-tool-caller.js';

function parseArgs(argv: string[]): { playbookPath: string; params: ParamBindings } {
  const [playbookPath, ...rest] = argv;
  if (!playbookPath) {
    throw new Error("usage: rote-replay <playbook.yaml> [--params '{\"k\":\"v\"}']");
  }
  const paramsIndex = rest.indexOf('--params');
  const params: ParamBindings =
    paramsIndex === -1 ? {} : (JSON.parse(rest[paramsIndex + 1] ?? '{}') as ParamBindings);
  return { playbookPath, params };
}

/** No slot/judgment steps → no LLM client is ever constructed or called. */
const NO_LLM_CLIENT: LlmClient = {
  complete: () => {
    throw new Error('This playbook has slot/judgment steps but no LLM client is configured (set the selected provider API key).');
  },
};

export async function main(argv: string[]): Promise<string> {
  const { playbookPath, params } = parseArgs(argv);
  const playbook = parsePlaybookYaml(readFileSync(playbookPath, 'utf8'));

  const downstreamCommand = process.env['ROTE_DOWNSTREAM_COMMAND'];
  if (!downstreamCommand) throw new Error('ROTE_DOWNSTREAM_COMMAND is required');
  const downstreamArgs = process.env['ROTE_DOWNSTREAM_ARGS']
    ? (JSON.parse(process.env['ROTE_DOWNSTREAM_ARGS']) as string[])
    : [];
  const toolCaller = new McpToolCaller({ command: downstreamCommand, args: downstreamArgs });

  const needsLlm = playbook.steps.some((step) => step.kind === 'slot' || step.kind === 'judgment');
  const llmClient: LlmClient = needsLlm ? new TaggedExecutorLlmClient() : NO_LLM_CLIENT;

  const targetIdentity = process.env['ROTE_TARGET_IDENTITY'] ?? playbook.task_signature.env_fingerprint.domain;
  // A minimal, unmatched-against fingerprint — the executor records what
  // environment it ran in; comparing it against a playbook's pattern to
  // decide whether to replay at all is the Matcher's job (M4), not this one.
  const envFingerprint = buildEnvFingerprint({
    tool_inventory: [],
    target_identity: targetIdentity,
    surface_versions: {},
  });

  const result = await runPlaybook(playbook, params, {
    toolCaller,
    llmClient,
    envFingerprint,
    taskSpec: process.env['ROTE_TASK_SPEC'] ?? playbook.task_signature.intent_description,
    baseDir: process.env['ROTE_BASE_DIR'] ?? '.rote',
  });

  await toolCaller.close();
  return JSON.stringify(result, null, 2);
}
