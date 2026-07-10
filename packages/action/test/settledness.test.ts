import { describe, expect, it } from 'vitest';
import { SettledBrowserPageSession, SettlednessTimeoutError, waitForSettled, type BrowserActivitySample } from '../src/index.js';

function fakeTime() {
  let now = 0;
  return {
    clock: () => now,
    sleep: async (ms: number) => { now += ms; },
  };
}

describe('waitForSettled', () => {
  it('requires zero pending requests and an unchanged DOM for the full quiet window', async () => {
    const time = fakeTime();
    const samples: BrowserActivitySample[] = [
      { pendingRequests: 1, mutationVersion: 1 },
      { pendingRequests: 1, mutationVersion: 2 },
      { pendingRequests: 0, mutationVersion: 2 },
    ];
    let index = 0;

    const result = await waitForSettled({
      async sampleActivity() {
        const sample = samples[Math.min(index, samples.length - 1)]!;
        index += 1;
        return sample;
      },
    }, { quietWindowMs: 100, pollIntervalMs: 50, timeoutMs: 1000, ...time });

    expect(result).toEqual({ pendingRequests: 0, mutationVersion: 2 });
    expect(time.clock()).toBe(150);
  });

  it('fails loudly when activity exceeds the timeout', async () => {
    const time = fakeTime();

    await expect(waitForSettled({
      async sampleActivity() {
        return { pendingRequests: 1, mutationVersion: 1 };
      },
    }, { quietWindowMs: 100, pollIntervalMs: 50, timeoutMs: 150, ...time })).rejects.toBeInstanceOf(
      SettlednessTimeoutError,
    );
  });
});

describe('SettledBrowserPageSession', () => {
  it('waits after navigation and every mutating action', async () => {
    const calls: string[] = [];
    const page = {
      async navigate() { calls.push('navigate'); },
      async capture() { return { url: 'mem://page', title: '', html: '', elements: [] }; },
      async fill() { calls.push('fill'); },
      async select() { calls.push('select'); },
      async click() { calls.push('click'); },
      async sampleActivity() { calls.push('settle'); return { pendingRequests: 0, mutationVersion: 0 }; },
    };
    const settled = new SettledBrowserPageSession(page, { quietWindowMs: 0 });

    await settled.navigate('mem://page');
    await settled.fill('#name', 'Acme');
    await settled.select('#country', 'US');
    await settled.click('#submit');

    expect(calls).toEqual(['navigate', 'settle', 'fill', 'settle', 'select', 'settle', 'click', 'settle']);
  });
});
