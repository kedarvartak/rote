import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTrajectoryJsonl, RunManifestSchema } from '@rote/core';
import type { ProxyConfig } from '../src/proxy.js';
import { runPaths, runsRootDir } from '../src/run-paths.js';
import { FAKE_DOWNSTREAM_PATH, startDirectSession, startProxySession } from './helpers/proxy-session.js';

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-recorder-proxy-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function config(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    command: process.execPath,
    args: [FAKE_DOWNSTREAM_PATH],
    runId: 'run-fidelity',
    taskSpec: 'test task',
    targetIdentity: 'fake.example.com',
    baseDir,
    ...overrides,
  };
}

describe('runProxy: fidelity', () => {
  it('N tools/call round-trips produce exactly N events, seq strictly increasing, args/result byte-identical', async () => {
    const session = startProxySession(config());
    const calls = [
      { name: 'echo', args: { n: 1 } },
      { name: 'echo', args: { n: 2 } },
      { name: 'echo', args: { n: 3 } },
    ];
    const replies = [];
    for (const c of calls) {
      replies.push(await session.call(c.name, c.args));
    }
    await session.close();

    for (let i = 0; i < calls.length; i += 1) {
      expect(replies[i]?.result).toEqual({ echoed: calls[i]?.args });
    }

    const paths = runPaths(baseDir, 'run-fidelity');
    const events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    events.forEach((e, i) => {
      expect(e.tool).toBe('echo');
      expect(e.args).toEqual(calls[i]?.args);
      if (e.result_ref.kind === 'inline') {
        expect(e.result_ref.value).toEqual({ echoed: calls[i]?.args });
      }
    });
  });

  it('is observationally invisible: the client sees the exact same reply with or without the proxy', async () => {
    const session = startProxySession(config({ runId: 'run-invisible' }));
    const reply = await session.call('echo', { greeting: 'hi' });
    await session.close();
    expect(reply.result).toEqual({ echoed: { greeting: 'hi' } });
    expect(reply.error).toBeUndefined();
  });
});

describe('runProxy: passthrough on failure', () => {
  it('forwards a downstream error unchanged and records it with error populated', async () => {
    const session = startProxySession(config({ runId: 'run-fail' }));
    const reply = await session.call('fail', {});
    await session.close();

    expect(reply.result).toBeUndefined();
    expect(reply.error).toEqual({ code: -32000, message: 'boom' });

    const paths = runPaths(baseDir, 'run-fail');
    const events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
    expect(events).toHaveLength(1);
    expect(events[0]?.error).toEqual({ message: 'boom', code: '-32000' });

    const manifest = RunManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, 'utf8')));
    expect(manifest.outcome).toBe('failure');
  });
});

describe('runProxy: large results', () => {
  it('spills a result over the inline threshold to a blob, client still gets the full result', async () => {
    const session = startProxySession(config({ runId: 'run-big', inlineThresholdBytes: 1000 }));
    const reply = await session.call('big', { size: 50_000 });
    await session.close();

    expect((reply.result as { data: string }).data).toHaveLength(50_000);

    const paths = runPaths(baseDir, 'run-big');
    const events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
    expect(events[0]?.result_ref.kind).toBe('blob');
    if (events[0]?.result_ref.kind === 'blob') {
      const blob: unknown = JSON.parse(await readFile(events[0].result_ref.path, 'utf8'));
      expect((blob as { data: string }).data).toHaveLength(50_000);
    }
  });
});

describe('runProxy: concurrency', () => {
  it('two parallel sessions write two run files with no interleaving', async () => {
    const sessionA = startProxySession(config({ runId: 'run-a' }));
    const sessionB = startProxySession(config({ runId: 'run-b' }));

    await Promise.all([
      sessionA.call('echo', { who: 'a', i: 0 }),
      sessionB.call('echo', { who: 'b', i: 0 }),
      sessionA.call('echo', { who: 'a', i: 1 }),
      sessionB.call('echo', { who: 'b', i: 1 }),
    ]);
    await Promise.all([sessionA.close(), sessionB.close()]);

    const runDirs = await readdir(runsRootDir(baseDir));
    const [pathsA, pathsB] = [runPaths(baseDir, 'run-a'), runPaths(baseDir, 'run-b')];
    const eventsA = parseTrajectoryJsonl(await readFile(pathsA.trajectoryPath, 'utf8'));
    const eventsB = parseTrajectoryJsonl(await readFile(pathsB.trajectoryPath, 'utf8'));

    expect(eventsA).toHaveLength(2);
    expect(eventsB).toHaveLength(2);
    expect(eventsA.every((e) => e.args['who'] === 'a')).toBe(true);
    expect(eventsB.every((e) => e.args['who'] === 'b')).toBe(true);
    expect(runDirs.sort()).toEqual(['run-a', 'run-b']);
  });
});

describe('runProxy: env fingerprint', () => {
  it('captures the fingerprint from the client\'s own first tools/list call', async () => {
    const session = startProxySession(config({ runId: 'run-fp', targetIdentity: 'fake.example.com' }));
    await session.listTools();
    await session.call('echo', {});
    await session.close();

    const paths = runPaths(baseDir, 'run-fp');
    const manifest = RunManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, 'utf8')));
    expect(manifest.env_fingerprint.target_identity).toBe('fake.example.com');
    expect(manifest.env_fingerprint.tool_inventory.map((t) => t.name).sort()).toEqual([
      'big',
      'echo',
      'fail',
    ]);
  });
});

describe('runProxy: overhead', () => {
  it('adds well under 5ms p95 latency per call versus talking to the fake server directly', async () => {
    const direct = startDirectSession();
    const proxied = startProxySession(config({ runId: 'run-proxied' }));

    const sample = 30;
    const directTimes: number[] = [];
    const proxiedTimes: number[] = [];

    for (let i = 0; i < sample; i += 1) {
      const t0 = performance.now();
      await direct.call('echo', { i });
      directTimes.push(performance.now() - t0);
    }
    for (let i = 0; i < sample; i += 1) {
      const t0 = performance.now();
      await proxied.call('echo', { i });
      proxiedTimes.push(performance.now() - t0);
    }
    await Promise.all([direct.close(), proxied.close()]);

    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
    const overhead = p95(proxiedTimes) - p95(directTimes);
    expect(overhead).toBeLessThan(5);
  });
});
