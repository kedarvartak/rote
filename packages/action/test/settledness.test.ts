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

  it('can tolerate a declared background-request floor while still requiring DOM quiet', async () => {
    const time = fakeTime();
    const result = await waitForSettled({
      async sampleActivity() {
        return { pendingRequests: 1, mutationVersion: 3 };
      },
    }, { quietWindowMs: 100, pollIntervalMs: 50, timeoutMs: 150, maxPendingRequests: 1, ...time });

    expect(result).toEqual({ pendingRequests: 1, mutationVersion: 3 });
    expect(time.clock()).toBe(100);
  });

  it('treats a network activity edge like a DOM mutation and ignores an answered streaming body (#132)', async () => {
    // A long-lived SPA session: one answered-but-unfinished response is not
    // "pending"; a data chunk (networkVersion bump) resets the quiet window even
    // with zero pending requests and an unchanged DOM.
    const time = fakeTime();
    const samples: BrowserActivitySample[] = [
      { pendingRequests: 0, mutationVersion: 4, networkVersion: 10 },
      { pendingRequests: 0, mutationVersion: 4, networkVersion: 11 },
      { pendingRequests: 0, mutationVersion: 4, networkVersion: 11 },
    ];
    let index = 0;
    const result = await waitForSettled({
      async sampleActivity() {
        const sample = samples[Math.min(index, samples.length - 1)]!;
        index += 1;
        return sample;
      },
    }, { quietWindowMs: 100, pollIntervalMs: 50, timeoutMs: 1000, ...time });

    expect(result).toEqual({ pendingRequests: 0, mutationVersion: 4, networkVersion: 11 });
    // Window restarted at t=50 (edge) and completed at t=150, not at t=100.
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

  it('reports each bounded settle with its verb and elapsed time, and never a timed-out one', async () => {
    const time = fakeTime();
    let busy = true;
    const page = {
      async navigate() {},
      async capture() { return { url: 'mem://page', title: '', html: '', elements: [] }; },
      async fill() {},
      async select() {},
      async click() { busy = true; },
      async sampleActivity() {
        const sample = { pendingRequests: busy ? 1 : 0, mutationVersion: 0 };
        busy = false;
        return sample;
      },
    };
    const records: Array<{ verb: string; elapsedMs: number }> = [];
    const settled = new SettledBrowserPageSession(page, {
      quietWindowMs: 100, pollIntervalMs: 50, timeoutMs: 120, ...time,
      onSettle: (record) => { records.push({ verb: record.verb, elapsedMs: record.elapsedMs }); },
    });

    await settled.click('#go');
    expect(records).toEqual([{ verb: 'click', elapsedMs: 100 }]);

    // A settle that times out throws and is not reported as a cost sample.
    const stuck = new SettledBrowserPageSession({ ...page, async sampleActivity() { return { pendingRequests: 1, mutationVersion: 0 }; } }, {
      quietWindowMs: 100, pollIntervalMs: 50, timeoutMs: 120, ...time,
      onSettle: (record) => { records.push({ verb: record.verb, elapsedMs: record.elapsedMs }); },
    });
    await expect(stuck.click('#go')).rejects.toBeInstanceOf(SettlednessTimeoutError);
    expect(records).toHaveLength(1);
  });
});
