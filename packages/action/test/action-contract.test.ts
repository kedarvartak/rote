import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyBrowserActionSafety,
  derivePostActionEvidence,
  KeyChordError,
  normalizeKeyChord,
} from '../src/index.js';
import type { CapturedPage } from '@rote/browser';

describe('normalizeKeyChord', () => {
  it('canonicalizes modifier order and aliases', () => {
    expect(normalizeKeyChord('ctrl+Enter')).toEqual({ chord: 'Control+Enter', modifiers: ['Control'], key: 'Enter' });
    expect(normalizeKeyChord('shift+alt+control+enter').chord).toBe('Alt+Control+Shift+Enter');
    expect(normalizeKeyChord('cmd+K')).toEqual({ chord: 'Meta+K', modifiers: ['Meta'], key: 'K' });
    expect(normalizeKeyChord('Escape')).toEqual({ chord: 'Escape', modifiers: [], key: 'Escape' });
  });

  it('rejects everything outside the explicit allowlist', () => {
    for (const chord of ['Control+Enter;alert(1)', 'Hyper+Enter', 'Control+', '+Enter', 'Control+Control+Enter', 'Control+DeleteAll', 'F13']) {
      expect(() => normalizeKeyChord(chord), chord).toThrow(KeyChordError);
    }
  });

  it('property: normalization is idempotent on its own canonical output', () => {
    const modifierArb = fc.uniqueArray(fc.constantFrom('Alt', 'Control', 'Meta', 'Shift'), { maxLength: 4 });
    const keyArb = fc.constantFrom('Enter', 'Tab', 'Escape', 'ArrowDown', 'F5', 'a', 'Z', '7');
    fc.assert(fc.property(modifierArb, keyArb, (modifiers, key) => {
      const first = normalizeKeyChord([...modifiers, key].join('+'));
      const second = normalizeKeyChord(first.chord);
      return second.chord === first.chord
        && JSON.stringify(second.modifiers) === JSON.stringify(first.modifiers);
    }));
  });
});

describe('classifyBrowserActionSafety', () => {
  it('classifies every dispatched verb and fails on unknown kinds', () => {
    expect(classifyBrowserActionSafety('hover')).toBe('read');
    expect(classifyBrowserActionSafety('fill')).toBe('local_input');
    expect(classifyBrowserActionSafety('select')).toBe('local_input');
    expect(classifyBrowserActionSafety('navigate')).toBe('navigation');
    expect(classifyBrowserActionSafety('click')).toBe('potentially_mutating');
    expect(classifyBrowserActionSafety('press')).toBe('potentially_mutating');
    expect(classifyBrowserActionSafety('upload')).toBe('mutating');
    expect(classifyBrowserActionSafety('dragAndDrop')).toBe('mutating');
    // INVARIANT: a verb without a safety class may not dispatch (#131).
    expect(() => classifyBrowserActionSafety('injectScript')).toThrow('unclassified');
  });
});

describe('post-action evidence for E7.5 verbs', () => {
  function page(extraText?: string): CapturedPage {
    return {
      url: 'https://portal.test/controls',
      title: 'Controls',
      html: '',
      elements: [
        { tag: 'button', attributes: { id: 'archive' }, text: 'Archive', depth: 1 },
        ...(extraText ? [{ tag: 'p', attributes: {}, text: extraText, depth: 1 }] : []),
      ],
    };
  }

  it.each(['hover', 'press', 'upload', 'dragAndDrop'] as const)('%s reaction is recorded but never enforced', (kind) => {
    const unchanged = derivePostActionEvidence({
      action: { kind },
      resolvedSelector: '#archive',
      before: page(),
      after: page(),
    });
    expect(unchanged).toMatchObject({
      action_kind: kind, strength: 'reaction', classification: 'no_observable_reaction',
      passed: false, enforced: false,
    });
    const reacted = derivePostActionEvidence({
      action: { kind },
      resolvedSelector: '#archive',
      before: page(),
      after: page('Menu opened'),
    });
    expect(reacted).toMatchObject({ classification: 'reaction_observed', passed: true, enforced: false });
  });
});
