import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { EnvFingerprint, RunManifest } from '@rote/core';
import { buildTrajectoryEvent } from './build-trajectory-event.js';
import { writeBlob } from './blob-store.js';
import { fingerprintFromToolsList, type ToolsListResult } from './fingerprint-session.js';
import { isRequest, isResponse, tryParseJsonRpcLine } from './jsonrpc.js';
import { writeRunManifest } from './manifest-writer.js';
import { runPaths } from './run-paths.js';
import { SequentialQueue } from './sequential-queue.js';
import { appendTrajectoryEvent } from './trajectory-writer.js';

export interface ProxyConfig {
  /** Downstream MCP server to wrap: spawned as `command args...` over stdio. */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  runId: string;
  taskSpec: string;
  targetIdentity: string;
  surfaceVersions?: Record<string, string>;
  /** Directory under which `.rote/runs/<runId>/...` is written. Default `.rote`. */
  baseDir: string;
  inlineThresholdBytes?: number;
  /** Injectable for deterministic tests; defaults to the wall clock. */
  clock?: () => Date;
}

interface PendingCall {
  tool: string;
  args: Record<string, unknown>;
  startedAtMs: number;
}

const EMPTY_FINGERPRINT_TARGET = 'unknown';

/**
 * Runs the proxy for one session: spawns the downstream MCP server, tees
 * `clientIn` -> child.stdin and child.stdout -> `clientOut` line-by-line,
 * and records a TrajectoryEvent per correlated `tools/call` request/response
 * pair. Every line is forwarded unmodified regardless of whether it parses
 * or is recorded — the proxy must be observationally invisible to the
 * client (docs/06-build-plan.md M1 "Fidelity"). Resolves once the
 * downstream process exits and every queued write has drained.
 */
export async function runProxy(config: ProxyConfig, clientIn: Readable, clientOut: Writable): Promise<void> {
  const paths = runPaths(config.baseDir, config.runId);
  const clock = config.clock ?? (() => new Date());
  const startedAt = clock().toISOString();

  const child = spawn(config.command, config.args ?? [], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...config.env },
  });
  if (!child.stdin || !child.stdout) {
    throw new Error(`failed to open stdio for downstream command "${config.command}"`);
  }

  const queue = new SequentialQueue();
  const pendingCalls = new Map<string | number, PendingCall>();
  const pendingListIds = new Set<string | number>();
  let seq = 0;
  let fingerprint: EnvFingerprint | undefined;
  let hadError = false;

  const clientRl = createInterface({ input: clientIn, terminal: false });
  clientRl.on('line', (line) => {
    const msg = tryParseJsonRpcLine(line);
    if (msg && isRequest(msg)) {
      if (msg.method === 'tools/call') {
        const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        pendingCalls.set(msg.id, {
          tool: params.name ?? 'unknown',
          args: params.arguments ?? {},
          startedAtMs: Date.now(),
        });
      } else if (msg.method === 'tools/list') {
        pendingListIds.add(msg.id);
      }
    }
    child.stdin.write(`${line}\n`);
  });
  clientRl.on('close', () => child.stdin.end());

  const childRl = createInterface({ input: child.stdout, terminal: false });
  childRl.on('line', (line) => {
    // Forward first and unconditionally: recording must never gate or alter
    // what the client receives (see docs/06-build-plan.md M1 "Fidelity").
    clientOut.write(`${line}\n`);

    const msg = tryParseJsonRpcLine(line);
    if (!msg || !isResponse(msg)) return;

    // v1 captures the fingerprint from the client's own first tools/list
    // response rather than proxy-issuing a synthetic one, so the proxy
    // never needs to perform its own MCP `initialize` handshake — see
    // packages/recorder/README.md "Known v1 limitations".
    if (fingerprint === undefined && pendingListIds.has(msg.id)) {
      pendingListIds.delete(msg.id);
      if (!msg.error) {
        fingerprint = fingerprintFromToolsList(
          msg.result as ToolsListResult,
          config.targetIdentity,
          config.surfaceVersions,
        );
      }
      return;
    }

    const call = pendingCalls.get(msg.id);
    if (!call) return;
    pendingCalls.delete(msg.id);

    const currentSeq = seq;
    seq += 1;
    const duration_ms = Date.now() - call.startedAtMs;
    const ts = clock().toISOString();
    const error = msg.error ? { message: msg.error.message, code: String(msg.error.code) } : undefined;
    if (error) hadError = true;

    const { event, blobWrite } = buildTrajectoryEvent({
      run_id: config.runId,
      seq: currentSeq,
      ts,
      tool: call.tool,
      args: call.args,
      result: msg.error ? undefined : msg.result,
      duration_ms,
      error,
      blobsDir: paths.blobsDir,
      inlineThresholdBytes: config.inlineThresholdBytes,
    });

    void queue.push(async () => {
      if (blobWrite) await writeBlob(blobWrite.path, blobWrite.contents);
      await appendTrajectoryEvent(paths.trajectoryPath, event);
    });
  });

  const exitCode: number | null = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  await queue.drain();

  const manifest: RunManifest = {
    run_id: config.runId,
    task_spec: config.taskSpec,
    env_fingerprint:
      fingerprint ??
      fingerprintFromToolsList({ tools: [] }, config.targetIdentity || EMPTY_FINGERPRINT_TARGET),
    // The recorder only ever sees the tool-call boundary, not task-level
    // intent, so "failure" here means "at least one recorded tool call
    // errored" — a deliberately narrow, honest heuristic for v1 (see
    // packages/recorder/README.md "Known v1 limitations").
    outcome: exitCode !== 0 || hadError ? 'failure' : 'success',
    started_at: startedAt,
    ended_at: clock().toISOString(),
    token_usage: [],
  };
  await writeRunManifest(paths.manifestPath, manifest);
}
