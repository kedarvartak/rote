export interface BrowserActivitySample {
  pendingRequests: number;
  mutationVersion: number;
}

export interface BrowserActivityProbe {
  sampleActivity(): Promise<BrowserActivitySample>;
}

export interface WaitForSettledOptions {
  quietWindowMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Background requests tolerated while the DOM remains quiet (default 0). */
  maxPendingRequests?: number;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Raised when browser activity never reaches the configured quiet window. */
export class SettlednessTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly lastSample: BrowserActivitySample,
  ) {
    super(`browser did not settle within ${timeoutMs}ms (${lastSample.pendingRequests} pending requests)`);
    this.name = 'SettlednessTimeoutError';
  }
}

/** Waits until network activity is zero and DOM mutations stay unchanged for a quiet window. */
export async function waitForSettled(
  probe: BrowserActivityProbe,
  options: WaitForSettledOptions = {},
): Promise<BrowserActivitySample> {
  const quietWindowMs = options.quietWindowMs ?? 250;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxPendingRequests = options.maxPendingRequests ?? 0;
  if (!Number.isInteger(maxPendingRequests) || maxPendingRequests < 0) {
    throw new Error('maxPendingRequests must be a non-negative integer');
  }
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = clock();
  let lastChangedAt = startedAt;
  let previous: BrowserActivitySample | undefined;
  let sample = await probe.sampleActivity();

  while (true) {
    const now = clock();
    const changed = !previous || sample.mutationVersion !== previous.mutationVersion;
    if (changed || sample.pendingRequests > maxPendingRequests) lastChangedAt = now;
    if (sample.pendingRequests <= maxPendingRequests && now - lastChangedAt >= quietWindowMs) return sample;
    if (now - startedAt >= timeoutMs) throw new SettlednessTimeoutError(timeoutMs, sample);
    previous = sample;
    await sleep(pollIntervalMs);
    sample = await probe.sampleActivity();
  }
}
