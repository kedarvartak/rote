import { describe, expect, it } from 'vitest';
import type { CapturedElement } from '@rote/browser';
import { isElementVisible, matchesElementSelector } from '../src/index.js';

const element = (tag: string, attributes: Record<string, string>, text = ''): CapturedElement =>
  ({ tag, attributes, text, depth: 0 });

describe('isElementVisible', () => {
  it.each([
    ['a plain element', element('div', {}), true],
    ['the fixture escape hatch', element('div', { 'data-rote-visible': 'false' }), false],
    ['the hidden attribute', element('div', { hidden: '' }), false],
    ['aria-hidden', element('div', { 'aria-hidden': 'true' }), false],
    ['aria-hidden="false"', element('div', { 'aria-hidden': 'false' }), true],
    ['a hidden input', element('input', { type: 'hidden' }), false],
    ['a text input', element('input', { type: 'text' }), true],
    ['display:none', element('div', { style: 'display:none' }), false],
    ['display: none with spaces', element('div', { style: 'display: none' }), false],
    ['DISPLAY:NONE uppercase', element('div', { style: 'DISPLAY:NONE' }), false],
    ['visibility:hidden', element('div', { style: 'visibility:hidden' }), false],
    ['opacity:0', element('div', { style: 'opacity:0' }), false],
    ['opacity:0.0', element('div', { style: 'opacity:0.0' }), false],
    ['opacity:0.5 — translucent is not hidden', element('div', { style: 'opacity:0.5' }), true],
    ['opacity:0.05 — nor is barely visible', element('div', { style: 'opacity:0.05' }), true],
    ['opacity:1', element('div', { style: 'opacity:1' }), true],
    ['a colour that merely contains the substring', element('div', { style: 'color:#opacity000' }), true],
  ])('%s', (_name, node, expected) => {
    expect(isElementVisible(node)).toBe(expected);
  });

  it('does not read opacity out of another property whose value ends in 0', () => {
    // Substring matching for "opacity:0" is what the dispatcher's copy did, and
    // it hid every translucent control. The rule parses the value instead.
    expect(isElementVisible(element('div', { style: 'z-index:0;opacity:0.5' }))).toBe(true);
    expect(isElementVisible(element('div', { style: 'z-index:5;opacity:0' }))).toBe(false);
  });
});

describe('matchesElementSelector', () => {
  const input = element('input', { id: 'vendor', class: 'field required', name: 'vendor_name', 'data-rote-selector': '#named' });

  it.each([
    ['#id', '#vendor', true],
    ['a different #id', '#other', false],
    ['.class among several', '.required', true],
    ['a class that is only a prefix', '.requir', false],
    ['a bare tag', 'input', true],
    ['a bare tag, case-insensitively', 'INPUT', true],
    ['the wrong tag', 'select', false],
    ['tag[attr="value"]', 'input[name="vendor_name"]', true],
    ['[attr="value"] with no tag', '[name="vendor_name"]', true],
    ['tag[attr="value"] with the wrong tag', 'select[name="vendor_name"]', false],
    ['the fixture escape hatch', '#named', true],
    ['an unsupported selector fails rather than matching loosely', 'input > .field', false],
    ['a descendant selector', 'form input', false],
  ])('%s', (_name, selector, expected) => {
    expect(matchesElementSelector(input, selector)).toBe(expected);
  });

  it('never matches an inherited property name through the attribute form', () => {
    // `element.attributes[name]` takes its key from the selector, which is
    // page- or planner-derived; an inherited member must not read as an
    // attribute value (see #212 for the same edge in templating).
    expect(matchesElementSelector(input, '[constructor="x"]')).toBe(false);
    expect(matchesElementSelector(input, '[toString="x"]')).toBe(false);
  });
});
