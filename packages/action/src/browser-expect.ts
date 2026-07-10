import type { CapturedElement, CapturedPage } from '@rote/browser';
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
    const pass = page.elements.some((element) => matchesSelector(element, expect.selector_visible) && isVisible(element));
    return result(pass, `selector "${expect.selector_visible}" not visible`);
  }
  if ('selector_absent' in expect) {
    const pass = !page.elements.some((element) => matchesSelector(element, expect.selector_absent) && isVisible(element));
    return result(pass, `selector "${expect.selector_absent}" still visible`);
  }
  if ('input_value' in expect) {
    const element = page.elements.find((candidate) => matchesSelector(candidate, expect.input_value));
    const actual = element?.attributes['value'];
    return result(actual === expect.equals, `input "${expect.input_value}" value was ${JSON.stringify(actual)}, expected ${JSON.stringify(expect.equals)}`);
  }
  if ('url_contains' in expect) {
    return result(page.url.includes(expect.url_contains), `URL "${page.url}" does not contain "${expect.url_contains}"`);
  }
  const text = [page.title, ...page.elements.filter(isVisible).map((element) => element.text)].join(' ');
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

function isVisible(element: CapturedElement): boolean {
  if ('hidden' in element.attributes || element.attributes['aria-hidden'] === 'true') return false;
  const style = element.attributes['style']?.replaceAll(' ', '').toLowerCase() ?? '';
  return !style.includes('display:none') && !style.includes('visibility:hidden');
}

function matchesSelector(element: CapturedElement, selector: string): boolean {
  if (selector.startsWith('#')) return element.attributes['id'] === selector.slice(1);
  if (selector.startsWith('.')) return (element.attributes['class'] ?? '').split(/\s+/).includes(selector.slice(1));
  const attribute = /^(?:([a-zA-Z][\w-]*))?\[([\w-]+)=["']([^"']+)["']\]$/.exec(selector);
  if (attribute) {
    const [, tag, name, value] = attribute;
    return (!tag || element.tag === tag.toLowerCase()) && element.attributes[name!] === value;
  }
  return element.tag === selector.toLowerCase();
}
