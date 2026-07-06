import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StaticHtmlBackend, captureStaticHtml } from '../src/index.js';

describe('StaticHtmlBackend', () => {
  it('captures fixture HTML into deterministic elements', async () => {
    const backend = new StaticHtmlBackend();
    const page = await backend.capture(resolve('../../fixtures/sites/b1-report.html'));

    expect(page.title).toBe('Reports Portal');
    expect(page.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: 'input', attributes: expect.objectContaining({ id: 'username' }) }),
        expect.objectContaining({ tag: 'button', attributes: expect.objectContaining({ id: 'login-submit' }) }),
      ]),
    );
  });

  it('captures the same HTML byte-stably', () => {
    const html = '<html><head><title>X</title></head><body><button id="go">Go</button></body></html>';

    expect(captureStaticHtml('mem://x', html)).toEqual(captureStaticHtml('mem://x', html));
  });
});
