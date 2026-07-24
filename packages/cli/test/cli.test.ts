import { describe, expect, it, vi } from 'vitest';
import { main, type BrowserTaskResult, type CliDependencies } from '../src/index.js';

function dependencies(result: BrowserTaskResult = { runId: 'run-1', success: true, summary: 'report downloaded', steps: 4, inputTokens: 120, outputTokens: 20, phase: 'cold' as const }) {
  return { runBrowserTask: vi.fn(async () => result) } satisfies CliDependencies;
}

describe('rote run', () => {
  it('parses browser task options and prints run accounting', async () => {
    const deps = dependencies();

    const output = await main([
      'run',
      'Download the latest report',
      '--url', 'https://portal.test/login',
      '--model', 'claude-test',
      '--max-steps', '12',
      '--chrome-path', '/usr/bin/chrome',
      '--verify-text', 'Download complete',
      '--settle-timeout-ms', '7000',
      '--viewport-width', '1920',
      '--viewport-height', '1080',
      '--replay-candidate', 'candidate.json',
    ], '/tmp/rote-test', deps);

    expect(deps.runBrowserTask).toHaveBeenCalledWith({
      task: 'Download the latest report',
      url: 'https://portal.test/login',
      baseDir: '/tmp/rote-test',
      model: 'claude-test',
      maxSteps: 12,
      chromePath: '/usr/bin/chrome',
      viewport: { width: 1920, height: 1080 },
      verifyText: 'Download complete',
      verifyUrlContains: undefined,
      settleTimeoutMs: 7000,
      replayCandidatePath: 'candidate.json',
    });
    expect(output).toContain('success: report downloaded');
    expect(output).toContain('phase: cold');
    expect(output).toContain('tokens: 120 input + 20 output');
  });

  it('pins the run id from ROTE_RUN_ID so the benchmark driver can address the run', async () => {
    const deps = dependencies();
    const previous = process.env['ROTE_RUN_ID'];
    process.env['ROTE_RUN_ID'] = 'b1-cold-7';
    try {
      await main(['run', 'Do the task', '--url', 'https://portal.test', '--verify-text', 'ok'], '.rote', deps);
    } finally {
      if (previous === undefined) delete process.env['ROTE_RUN_ID'];
      else process.env['ROTE_RUN_ID'] = previous;
    }
    expect(deps.runBrowserTask).toHaveBeenCalledWith(expect.objectContaining({ runId: 'b1-cold-7' }));
  });

  it('assigns no fixed run id when ROTE_RUN_ID is unset', async () => {
    const deps = dependencies();
    const previous = process.env['ROTE_RUN_ID'];
    delete process.env['ROTE_RUN_ID'];
    try {
      await main(['run', 'Do the task', '--url', 'https://portal.test', '--verify-text', 'ok'], '.rote', deps);
    } finally {
      if (previous !== undefined) process.env['ROTE_RUN_ID'] = previous;
    }
    expect(deps.runBrowserTask.mock.calls[0]?.[0]).not.toHaveProperty('runId');
  });

  it('prints the retained replay failure classification after cold fallback', async () => {
    const deps = dependencies({
      runId: 'cold-2', success: true, summary: 'cold completed', steps: 1,
      inputTokens: 10, outputTokens: 2, phase: 'cold',
      fallbackReason: 'replay_failed', fallbackDetail: 'verify text absent',
    });
    await expect(main([
      'run', 'Do the task', '--url', 'https://portal.test', '--verify-text', 'Complete',
    ], '.rote', deps)).resolves.toContain('fallback: replay_failed (verify text absent)');
  });

  it('requires a starting URL', async () => {
    await expect(main(['run', 'Do the task'], '.rote', dependencies())).rejects.toThrow(
      'rote run <task> --url <url>',
    );
  });

  it('exits as a failure when the agent does not complete the task', async () => {
    const deps = dependencies({
      runId: 'run-failed',
      success: false,
      summary: 'planner exceeded maxSteps=2',
      steps: 2,
      inputTokens: 50,
      outputTokens: 10,
      phase: 'cold' as const,
      fallbackReason: 'replay_error',
      fallbackDetail: 'replay transport broke',
    });

    await expect(main([
      'run', 'Do the task', '--url', 'https://portal.test', '--verify-text', 'Complete',
    ], '.rote', deps)).rejects.toThrow(
      'browser task failed (run run-failed): planner exceeded maxSteps=2; fallback: replay_error (replay transport broke)',
    );
  });
});
