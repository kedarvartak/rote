import { describe, expect, it } from 'vitest';
import { captureStaticHtml } from '@rote/browser';
import { distillPage, type DistilledNode } from '@rote/perception';
import { ElementResolutionError, resolveElementTarget } from '../src/index.js';

const nodes: DistilledNode[] = [
  {
    id: { hash: 'aaaaaaaaaaaaaaaa' },
    role: 'button',
    name: 'Submit registration',
    tag: 'button',
    selectorHint: '#new-submit-id',
    depth: 2,
    interactive: true,
  },
  {
    id: { hash: 'bbbbbbbbbbbbbbbb' },
    role: 'link',
    name: 'Open Alpha result',
    tag: 'a',
    selectorHint: '#alpha-link',
    depth: 2,
    interactive: true,
  },
];

describe('resolveElementTarget', () => {
  it('keeps the stable-ID path working when a selector attribute drifts', () => {
    const before = distillPage(captureStaticHtml('mem://before', '<button id="submit">Submit</button>'))[0]!;
    const after = distillPage(captureStaticHtml('mem://after', '<button id="submit-v2">Submit</button>'));

    expect(resolveElementTarget(after, {
      selector: '#submit',
      stableId: before.id.hash,
    })).toEqual({ selector: '#submit-v2', strategy: 'stable-id', stableId: before.id.hash });
  });

  it('prefers a stable node ID over a stale supplied selector', () => {
    expect(resolveElementTarget(nodes, {
      selector: '#old-submit-id',
      stableId: 'aaaaaaaaaaaaaaaa',
      role: 'button',
      name: 'Submit registration',
    })).toEqual({ selector: '#new-submit-id', strategy: 'stable-id', stableId: 'aaaaaaaaaaaaaaaa' });
  });

  it('falls back to role and name when the stable ID misses', () => {
    expect(resolveElementTarget(nodes, {
      selector: '#old-submit-id',
      stableId: 'cccccccccccccccc',
      role: 'button',
      name: 'submit REGISTRATION',
    }).strategy).toBe('role-name');
  });

  it('falls back to text proximity before using a stale selector', () => {
    expect(resolveElementTarget(nodes, {
      selector: '#old-alpha-link',
      text: 'Open Alpha',
    })).toEqual({ selector: '#alpha-link', strategy: 'text-proximity', stableId: 'bbbbbbbbbbbbbbbb' });
  });

  it('uses the supplied selector only for legacy selector-only actions', () => {
    expect(resolveElementTarget(nodes, { selector: '#legacy' })).toEqual({
      selector: '#legacy',
      strategy: 'selector',
    });
  });

  it('rejects ambiguous semantic matches instead of clicking the first candidate', () => {
    const duplicate = { ...nodes[0]!, id: { hash: 'dddddddddddddddd' }, selectorHint: '#second-submit' };
    expect(() => resolveElementTarget([...nodes, duplicate], {
      selector: '#stale',
      role: 'button',
      name: 'Submit registration',
    })).toThrow(ElementResolutionError);
  });

  it('does not use a stale selector when supplied semantic identity misses', () => {
    expect(() => resolveElementTarget(nodes, {
      selector: '#now-points-somewhere-else',
      stableId: 'cccccccccccccccc',
    })).toThrow(ElementResolutionError);
  });

  it('fails loudly when no fallback can produce a selector', () => {
    expect(() => resolveElementTarget([], { selector: '', role: 'button', name: 'Missing' })).toThrow(
      ElementResolutionError,
    );
  });
});
