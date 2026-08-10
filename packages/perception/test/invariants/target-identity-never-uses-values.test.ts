import { describe, expect, it } from 'vitest';
import { captureStaticHtml } from '@rote/browser';
import { distillPage } from '../../src/index.js';

describe('target identity never persists captured form values', () => {
  it('keeps identity and planner-visible names unchanged when sensitive values change', () => {
    const capture = (value: string) => distillPage(captureStaticHtml('mem://credentials', `
      <form aria-label="Sign in">
        <input type="password" value="${value}" data-rote-selector="#password">
      </form>
    `))[0]!;
    const first = capture('correct-horse-battery-staple');
    const second = capture('registry-token-secret');

    expect(second.id).toEqual(first.id);
    expect(first.name).toBe('');
    expect(JSON.stringify([first.id, second.id])).not.toMatch(/correct-horse|registry-token|secret/);
  });
});
