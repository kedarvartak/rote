import { describe, expect, it } from 'vitest';
import { BrowserToolCaller, type BrowserReplayPage } from '../../src/index.js';

class DriftPage implements BrowserReplayPage {
  clicked: string[] = [];
  constructor(private readonly ambiguous = false) {}
  async navigate(): Promise<void> {}
  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async click(selector: string): Promise<void> { this.clicked.push(selector); }
  async capture() {
    return {
      url: 'https://fixture.test/b5', title: 'Vendor Registration', html: '',
      elements: [
        { tag: 'button', attributes: { id: 'registration-submit', 'aria-label': 'Delete registration', 'data-destructive': 'true' }, text: 'Delete registration', depth: 2 },
        { tag: 'button', attributes: { id: 'registration-submit-v2', 'aria-label': 'Submit registration' }, text: 'Submit registration', depth: 2 },
        ...(this.ambiguous ? [{ tag: 'button', attributes: { id: 'registration-submit-copy', 'aria-label': 'Submit registration' }, text: 'Submit registration', depth: 2 }] : []),
      ],
    };
  }
}

const staleTarget = {
  selector: '#registration-submit', stableId: '0000000000000000',
  role: 'button', name: 'Submit registration', text: 'Submit registration',
};

describe('drift repair never silently dispatches an ungrounded target', () => {
  it('bypasses a destructive stale-selector decoy for the unique semantic target', async () => {
    const page = new DriftPage();
    const result = await new BrowserToolCaller(page).call('browser.click', staleTarget);

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(page.clicked).toEqual(['#registration-submit-v2']);
  });

  it('dispatches nothing when semantic candidates are ambiguous', async () => {
    const page = new DriftPage(true);
    const result = await new BrowserToolCaller(page).call('browser.click', staleTarget);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'BROWSER_TARGET_AMBIGUOUS' }),
    });
    expect(page.clicked).toEqual([]);
  });
});
