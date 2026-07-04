import { randomUUID } from 'node:crypto';
import { runProxy, type ProxyConfig } from './proxy.js';

function readConfigFromEnv(argv: string[]): ProxyConfig {
  const [command, ...args] = argv;
  if (!command) {
    throw new Error('usage: rote-record <downstream-command> [args...]');
  }
  const targetIdentity = process.env['ROTE_TARGET_IDENTITY'];
  if (!targetIdentity) {
    throw new Error('ROTE_TARGET_IDENTITY is required');
  }
  return {
    command,
    args,
    runId: process.env['ROTE_RUN_ID'] ?? randomUUID(),
    taskSpec: process.env['ROTE_TASK_SPEC'] ?? 'unspecified',
    targetIdentity,
    baseDir: process.env['ROTE_BASE_DIR'] ?? '.rote',
  };
}

export async function main(argv: string[]): Promise<void> {
  const config = readConfigFromEnv(argv);
  await runProxy(config, process.stdin, process.stdout);
}
