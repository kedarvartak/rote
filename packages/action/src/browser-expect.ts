import type { CapturedPage } from '@rote/browser';
import { isElementVisible, matchesElementSelector } from '@rote/perception';
import type { BrowserExpect } from '@rote/core';

export interface BrowserExpectResult {
  pass: boolean;
  reason: string;
}

/** Raised when a live browser action postcondition fails. */
export class BrowserExpectationError extends Error {
  constructor(
    readonly expect: BrowserExpect,
    readonly pageUrl: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'BrowserExpectationError';
  }
}

/** Evaluates the browser-observable Expect DSL subset against a captured live page. */
export function evaluateBrowserExpect(expect: BrowserExpect, page: CapturedPage): BrowserExpectResult {
  if ('selector_visible' in expect) {
    const pass = page.elements.some((element) => matchesElementSelector(element, expect.selector_visible) && isElementVisible(element));
    return result(pass, `selector "${expect.selector_visible}" not visible`);
  }
  if ('selector_absent' in expect) {
    const pass = !page.elements.some((element) => matchesElementSelector(element, expect.selector_absent) && isElementVisible(element));
    return result(pass, `selector "${expect.selector_absent}" still visible`);
  }
  if ('input_value' in expect) {
    const element = page.elements.find((candidate) => matchesElementSelector(candidate, expect.input_value));
    const actual = element?.attributes['value'];
    return result(actual === expect.equals, `input "${expect.input_value}" value was ${JSON.stringify(actual)}, expected ${JSON.stringify(expect.equals)}`);
  }
  if ('url_contains' in expect) {
    return result(page.url.includes(expect.url_contains), `URL "${page.url}" does not contain "${expect.url_contains}"`);
  }
  const text = [page.title, ...page.elements.filter(isElementVisible).map((element) => element.text)].join(' ');
  return result(text.includes(expect.text_visible), `text "${expect.text_visible}" not visible`);
}

/** Throws a typed error unless a live browser postcondition passes. */
export function assertBrowserExpect(expect: BrowserExpect, page: CapturedPage): void {
  const evaluated = evaluateBrowserExpect(expect, page);
  if (!evaluated.pass) throw new BrowserExpectationError(expect, page.url, evaluated.reason);
}

function result(pass: boolean, failureReason: string): BrowserExpectResult {
  return { pass, reason: pass ? 'ok' : failureReason };
}

