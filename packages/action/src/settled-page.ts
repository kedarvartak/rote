import type { CapturedPage } from '@rote/browser';
import { BrowserCapabilityUnsupportedError, type AllowedUploadFile, type NormalizedKeyChord } from './action-contract.js';
import { waitForSettled, type BrowserActivityProbe, type WaitForSettledOptions } from './settledness.js';

export interface SettleableBrowserPage extends BrowserActivityProbe {
  navigate(url: string): Promise<void>;
  capture(): Promise<CapturedPage>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  /** E7.5 verbs are optional: a backend without one yields a typed unsupported failure, never a silent substitute. */
  hover?(selector: string): Promise<void>;
  press?(selector: string, chord: NormalizedKeyChord): Promise<void>;
  upload?(selector: string, file: Pick<AllowedUploadFile, 'name' | 'mime_type' | 'content_base64'>): Promise<void>;
  dragAndDrop?(sourceSelector: string, targetSelector: string): Promise<void>;
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

  async hover(selector: string): Promise<void> {
    if (!this.page.hover) throw new BrowserCapabilityUnsupportedError('hover');
    await this.page.hover(selector);
    await waitForSettled(this.page, this.options);
  }

  async press(selector: string, chord: NormalizedKeyChord): Promise<void> {
    if (!this.page.press) throw new BrowserCapabilityUnsupportedError('press');
    await this.page.press(selector, chord);
    await waitForSettled(this.page, this.options);
  }

  async upload(selector: string, file: Pick<AllowedUploadFile, 'name' | 'mime_type' | 'content_base64'>): Promise<void> {
    if (!this.page.upload) throw new BrowserCapabilityUnsupportedError('upload');
    await this.page.upload(selector, file);
    await waitForSettled(this.page, this.options);
  }

  async dragAndDrop(sourceSelector: string, targetSelector: string): Promise<void> {
    if (!this.page.dragAndDrop) throw new BrowserCapabilityUnsupportedError('dragAndDrop');
    await this.page.dragAndDrop(sourceSelector, targetSelector);
    await waitForSettled(this.page, this.options);
  }
}
