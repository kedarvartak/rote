import type { CapturedPage } from '@rote/browser';
import { waitForSettled, type BrowserActivityProbe, type WaitForSettledOptions } from './settledness.js';

export interface SettleableBrowserPage extends BrowserActivityProbe {
  navigate(url: string): Promise<void>;
  capture(): Promise<CapturedPage>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
}

/** Decorates browser actions with a deterministic post-action settledness gate. */
export class SettledBrowserPageSession {
  constructor(
    private readonly page: SettleableBrowserPage,
    private readonly options: WaitForSettledOptions = {},
  ) {}

  async navigate(url: string): Promise<void> {
    await this.page.navigate(url);
    await waitForSettled(this.page, this.options);
  }

  async capture(): Promise<CapturedPage> {
    return this.page.capture();
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
    await waitForSettled(this.page, this.options);
  }

  async select(selector: string, value: string): Promise<void> {
    await this.page.select(selector, value);
    await waitForSettled(this.page, this.options);
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
    await waitForSettled(this.page, this.options);
  }
}
