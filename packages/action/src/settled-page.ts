import type { CapturedPage } from '@rote/browser';
import { BrowserCapabilityUnsupportedError, type NormalizedKeyChord } from './action-contract.js';
import { waitForSettled, type BrowserActivityProbe, type BrowserActivitySample, type WaitForSettledOptions } from './settledness.js';

/** Redacted dispatch shape for one allowlisted upload; `file_id` stays with the caller. */
export interface UploadDispatchFile {
  name: string;
  mimeType: string;
  contentBase64: string;
}

/** One measured post-action settle: which verb waited, for how long, and what it saw last. */
export interface SettleRecord {
  verb: 'navigate' | 'fill' | 'select' | 'click' | 'hover' | 'press' | 'upload' | 'dragAndDrop';
  /** Wall-clock milliseconds spent inside the settledness gate. */
  elapsedMs: number;
  sample: BrowserActivitySample;
}

/** Settledness options plus an optional per-action telemetry sink (#132 endurance accounting). */
export interface SettledBrowserPageSessionOptions extends WaitForSettledOptions {
  onSettle?: (record: SettleRecord) => void;
}

export interface SettleableBrowserPage extends BrowserActivityProbe {
  navigate(url: string): Promise<void>;
  capture(): Promise<CapturedPage>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  /** E7.5 verbs are optional: a backend without one yields a typed unsupported failure, never a silent substitute. */
  hover?(selector: string): Promise<void>;
  press?(selector: string, chord: NormalizedKeyChord): Promise<void>;
  upload?(selector: string, file: UploadDispatchFile): Promise<void>;
  dragAndDrop?(sourceSelector: string, targetSelector: string): Promise<void>;
}

/** Decorates browser actions with a deterministic post-action settledness gate. */
export class SettledBrowserPageSession {
  // Most recent settle, kept so a caller that owns the loop (the agent) can
  // attribute the measured settle to the step it just dispatched without a
  // shared mutable sink; see docs/02 "Tiers 1 and 2" — settle priors are
  // tier-2 site memory and must come from measured settles, never wall-clock
  // guesses around dispatch+capture.
  private last?: SettleRecord;

  constructor(
    private readonly page: SettleableBrowserPage,
    private readonly options: SettledBrowserPageSessionOptions = {},
  ) {}

  /** The settle measured by the most recent action on this session, if any. */
  lastSettle(): SettleRecord | undefined {
    return this.last;
  }

  async navigate(url: string): Promise<void> {
    await this.page.navigate(url);
    await this.settle('navigate');
  }

  async capture(): Promise<CapturedPage> {
    return this.page.capture();
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
    await this.settle('fill');
  }

  async select(selector: string, value: string): Promise<void> {
    await this.page.select(selector, value);
    await this.settle('select');
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
    await this.settle('click');
  }

  async hover(selector: string): Promise<void> {
    if (!this.page.hover) throw new BrowserCapabilityUnsupportedError('hover');
    await this.page.hover(selector);
    await this.settle('hover');
  }

  async press(selector: string, chord: NormalizedKeyChord): Promise<void> {
    if (!this.page.press) throw new BrowserCapabilityUnsupportedError('press');
    await this.page.press(selector, chord);
    await this.settle('press');
  }

  async upload(selector: string, file: UploadDispatchFile): Promise<void> {
    if (!this.page.upload) throw new BrowserCapabilityUnsupportedError('upload');
    await this.page.upload(selector, file);
    await this.settle('upload');
  }

  async dragAndDrop(sourceSelector: string, targetSelector: string): Promise<void> {
    if (!this.page.dragAndDrop) throw new BrowserCapabilityUnsupportedError('dragAndDrop');
    await this.page.dragAndDrop(sourceSelector, targetSelector);
    await this.settle('dragAndDrop');
  }

  // A settle that times out throws `SettlednessTimeoutError` from waitForSettled;
  // the sink only ever sees bounded, successful waits, so its totals are the
  // cost of the policy rather than a mix of costs and failures.
  private async settle(verb: SettleRecord['verb']): Promise<void> {
    const clock = this.options.clock ?? Date.now;
    const startedAt = clock();
    const sample = await waitForSettled(this.page, this.options);
    const record: SettleRecord = { verb, elapsedMs: Math.max(0, clock() - startedAt), sample };
    this.last = record;
    this.options.onSettle?.(record);
  }
}
