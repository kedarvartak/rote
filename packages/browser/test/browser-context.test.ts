import { describe, expect, it } from 'vitest';
import { browserContextCoordinate, browserContextHash } from '../src/index.js';

const frame = { kind: 'frame' as const, keyHash: '1111111111111111', originHash: '2222222222222222' };

describe('browser context coordinates', () => {
  it('keeps top-level identity compatible with identity v2', () => {
    expect(browserContextHash([])).toBe('28720365c5e7476a');
  });

  it('excludes fresh document tokens from durable context identity', () => {
    const first = browserContextCoordinate([frame], 'aaaaaaaaaaaaaaaa');
    const navigated = browserContextCoordinate([frame], 'bbbbbbbbbbbbbbbb');

    expect(navigated.contextHash).toBe(first.contextHash);
    expect(navigated.documentToken).not.toBe(first.documentToken);
  });

  it('distinguishes cross-origin and nested shadow paths', () => {
    const same = browserContextHash([frame]);
    const cross = browserContextHash([{ ...frame, originHash: '3333333333333333' }]);
    const shadow = browserContextHash([frame, { kind: 'shadow', keyHash: '4444444444444444', mode: 'open' }]);

    expect(new Set([same, cross, shadow]).size).toBe(3);
  });
});
