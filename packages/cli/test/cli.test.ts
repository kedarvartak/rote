import { describe, expect, it, vi } from 'vitest';
import { main, type CliDependencies } from '../src/index.js';

function dependencies(result = { runId: 'run-1', success: true, summary: 'report downloaded', steps: 4, inputTokens: 120, outputTokens: 20 }) {
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
    ], '/tmp/rote-test', deps);

    expect(deps.runBrowserTask).toHaveBeenCalledWith({
      task: 'Download the latest report',
      url: 'https://portal.test/login',
      baseDir: '/tmp/rote-test',
      model: 'claude-test',
      maxSteps: 12,
      chromePath: '/usr/bin/chrome',
      verifyText: 'Download complete',
      verifyUrlContains: undefined,
    });
    expect(output).toContain('success: report downloaded');
    expect(output).toContain('tokens: 120 input + 20 output');
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
    });

    await expect(main([
      'run', 'Do the task', '--url', 'https://portal.test', '--verify-text', 'Complete',
    ], '.rote', deps)).rejects.toThrow(
      'browser task failed (run run-failed): planner exceeded maxSteps=2',
    );
  });
});
