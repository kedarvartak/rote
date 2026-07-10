import { describe, expect, it } from 'vitest';
import type { CapturedPage } from '@rote/browser';
import { BrowserExpectationError, assertBrowserExpect, evaluateBrowserExpect } from '../src/index.js';

const page: CapturedPage = {
  url: 'https://portal.test/complete',
  title: 'Complete',
  html: '',
  elements: [
    { tag: 'input', attributes: { id: 'company', value: 'Acme' }, text: '', depth: 1 },
    { tag: 'button', attributes: { id: 'submit' }, text: 'Submit registration', depth: 1 },
    { tag: 'p', attributes: { id: 'hidden', hidden: 'true' }, text: 'Secret', depth: 1 },
  ],
};

describe('evaluateBrowserExpect', () => {
  it.each([
    [{ selector_visible: '#submit' }, true],
    [{ selector_absent: '#missing' }, true],
    [{ input_value: '#company', equals: 'Acme' }, true],
    [{ url_contains: '/complete' }, true],
    [{ text_visible: 'Submit registration' }, true],
    [{ selector_visible: '#hidden' }, false],
    [{ input_value: '#company', equals: 'Other' }, false],
    [{ text_visible: 'Secret' }, false],
  ] as const)('evaluates %j as %s', (assertion, pass) => {
    expect(evaluateBrowserExpect(assertion, page).pass).toBe(pass);
  });

  it('throws a typed error with the failing page URL', () => {
    try {
      assertBrowserExpect({ text_visible: 'Downloaded' }, page);
      throw new Error('expected assertion to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserExpectationError);
      expect((error as BrowserExpectationError).pageUrl).toBe(page.url);
    }
  });
});
