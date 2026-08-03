import type { CapturedPage } from '@rote/browser';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PostActionEvidenceError, assertPostActionEvidence, derivePostActionEvidence } from '../src/index.js';

function page(url = 'https://portal.test/form', value = '', extraText?: string): CapturedPage {
  return {
    url,
    title: 'Portal',
    html: '',
    elements: [
      { tag: 'input', attributes: { id: 'company', value }, text: '', depth: 1 },
      { tag: 'select', attributes: { id: 'country', value }, text: '', depth: 1 },
      { tag: 'button', attributes: { id: 'submit' }, text: 'Submit', depth: 1 },
      ...(extraText ? [{ tag: 'p', attributes: {}, text: extraText, depth: 1 }] : []),
    ],
  };
}

describe('post-action evidence', () => {
  it('property-checks exact fill effects without copying values into evidence', () => {
    fc.assert(fc.property(fc.string(), (value) => {
      const evidence = derivePostActionEvidence({
        action: { kind: 'fill', value },
        resolvedSelector: '#company',
        before: page(),
        after: page('https://portal.test/form', value),
      });
      expect(evidence).toMatchObject({
        action_kind: 'fill', strength: 'strong', classification: 'exact_effect_observed',
        passed: true, enforced: true, target: '#company',
      });
      expect(evidence).not.toHaveProperty('value');
    }));
  });

  it('redacts a missing sensitive value from evidence and errors', () => {
    const secret = 'customer-secret-42';
    const evidence = derivePostActionEvidence({
      action: { kind: 'fill', value: secret },
      resolvedSelector: '#company',
      before: page(),
      after: page(),
    });
    expect(JSON.stringify(evidence)).not.toContain(secret);
    try {
      assertPostActionEvidence(evidence, 'https://portal.test/form');
      throw new Error('expected strong evidence failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PostActionEvidenceError);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('enforces exact select effects', () => {
    const evidence = derivePostActionEvidence({
      action: { kind: 'select', value: 'US' },
      resolvedSelector: '#country',
      before: page(),
      after: page('https://portal.test/form', 'CA'),
    });
    expect(evidence).toMatchObject({ classification: 'exact_effect_missing', passed: false, enforced: true });
    expect(() => assertPostActionEvidence(evidence, 'https://portal.test/form')).toThrow(PostActionEvidenceError);
  });

  it('property-checks canonical exact navigation effects', () => {
    fc.assert(fc.property(fc.webUrl(), (url) => {
      const evidence = derivePostActionEvidence({
        action: { kind: 'navigate', url }, before: page(), after: page(new URL(url).href),
      });
      expect(evidence).toMatchObject({ classification: 'exact_effect_observed', passed: true, enforced: true });
    }));
  });

  it('canonicalizes a requested navigation and rejects a redirect', () => {
    const pass = derivePostActionEvidence({
      action: { kind: 'navigate', url: '../done' },
      before: page('https://portal.test/forms/new'),
      after: page('https://portal.test/done'),
    });
    const redirect = derivePostActionEvidence({
      action: { kind: 'navigate', url: 'https://portal.test/done' },
      before: page(),
      after: page('https://login.test/session'),
    });
    expect(pass).toMatchObject({ classification: 'exact_effect_observed', passed: true, enforced: true });
    expect(redirect).toMatchObject({ classification: 'exact_effect_missing', passed: false, enforced: true });
  });

  it('detects a no-op click without enforcing reaction evidence', () => {
    const evidence = derivePostActionEvidence({
      action: { kind: 'click' }, resolvedSelector: '#submit', before: page(), after: page(),
    });
    expect(evidence).toMatchObject({
      strength: 'reaction', classification: 'click_no_observable_reaction', passed: false, enforced: false,
    });
    expect(() => assertPostActionEvidence(evidence, 'https://portal.test/form')).not.toThrow();
  });

  it.each([
    ['a visible DOM change', page('https://portal.test/form', '', 'Saved')],
    ['a URL change', page('https://portal.test/complete')],
    // The derivation intentionally cannot attribute this mutation to the click.
    ['unrelated visible mutation', page('https://portal.test/form', '', 'Clock: 12:01')],
  ])('records %s only as a click reaction', (_label, after) => {
    const evidence = derivePostActionEvidence({
      action: { kind: 'click' }, resolvedSelector: '#submit', before: page(), after,
    });
    expect(evidence).toMatchObject({
      strength: 'reaction', classification: 'click_reaction_observed', passed: true, enforced: false,
    });
  });

  it('matches the unique selector retained by a CDP capture', () => {
    const after = page();
    after.elements[0]!.attributes = { 'data-rote-selector': '#panel > input:nth-of-type(2)', value: 'Acme' };
    const evidence = derivePostActionEvidence({
      action: { kind: 'fill', value: 'Acme' },
      resolvedSelector: '#panel > input:nth-of-type(2)',
      before: page(),
      after,
    });
    expect(evidence.passed).toBe(true);
  });
});
