import { describe, expect, it } from 'vitest';
import { BrowserToolCaller, type BrowserReplayPage } from '../src/index.js';

class FakeBrowserPage implements BrowserReplayPage {
  url = 'about:blank';
  values = new Map<string, string>();
  confirmationVisible = false;

  async navigate(url: string): Promise<void> { this.url = url; }
  async fill(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async select(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async click(selector: string): Promise<void> {
    if (selector === '#submit') this.confirmationVisible = true;
  }
  async capture() {
    return {
      url: this.url,
      title: 'Vendor Registration',
      html: '',
      elements: [
        { tag: 'form', attributes: { id: 'registration-form' }, text: '', depth: 0 },
        { tag: 'input', attributes: { id: 'company', value: this.values.get('#company') ?? '' }, text: '', depth: 1 },
        { tag: 'select', attributes: { id: 'country', value: this.values.get('#country') ?? 'US' }, text: '', depth: 1 },
        { tag: 'button', attributes: { id: 'submit' }, text: 'Submit', depth: 1 },
        { tag: 'h2', attributes: { id: 'confirmation', ...(this.confirmationVisible ? {} : { hidden: 'true' }) }, text: 'Registration complete', depth: 1 },
        { tag: 'h2', attributes: { id: 'alpha' }, text: 'Alpha result', depth: 1 },
      ],
    };
  }
}

describe('BrowserToolCaller', () => {
  it('dispatches browser tools and returns the executor observation convention', async () => {
    const caller = new BrowserToolCaller(new FakeBrowserPage());

    expect(await caller.call('browser.navigate', { url: 'https://fixture.test/b2' })).toEqual(expect.objectContaining({ ok: true }));
    const fill = await caller.call('browser.fill', { selector: '#company', value: 'Acme' });
    const select = await caller.call('browser.select', { selector: '#country', value: 'US' });
    const click = await caller.call('browser.click', { selector: '#submit' });

    expect(fill).toEqual({
      ok: true,
      result: expect.objectContaining({ input_values: expect.objectContaining({ '#company': 'Acme' }) }),
    });
    expect(select).toEqual({
      ok: true,
      result: expect.objectContaining({ input_values: expect.objectContaining({ '#country': 'US' }) }),
    });
    expect(click).toEqual({
      ok: true,
      result: expect.objectContaining({
        visible_selectors: expect.arrayContaining(['#confirmation']),
        visible_text: expect.arrayContaining(['Registration complete']),
      }),
    });
  });

  it('extracts visible result headings into replayable JSON', async () => {
    const caller = new BrowserToolCaller(new FakeBrowserPage());

    const result = await caller.call('browser.extract', { selector: '#results', limit: 1 });

    expect(result).toEqual({
      ok: true,
      result: expect.objectContaining({ items: [{ name: 'Alpha result' }] }),
    });
  });

  it('returns a typed tool failure for unsupported or malformed calls', async () => {
    const caller = new BrowserToolCaller(new FakeBrowserPage());

    await expect(caller.call('browser.fill', { selector: '#company' })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'BROWSER_REPLAY_TOOL_ERROR' }),
    });
    await expect(caller.call('browser.unknown', {})).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ message: expect.stringContaining('unsupported') }),
    });
  });
});
