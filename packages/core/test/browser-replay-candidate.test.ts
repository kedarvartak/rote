import { describe, expect, it } from 'vitest';
import { BrowserReplayCandidateSchema } from '../src/index.js';

describe('BrowserReplayCandidateSchema', () => {
  it('parses an explicit versioned replay candidate', () => {
    expect(BrowserReplayCandidateSchema.parse({
      playbook_path: 'browser-b1.yaml',
      fingerprint_hash: 'a'.repeat(64),
      params: { username: 'analyst' },
    })).toEqual({
      playbook_path: 'browser-b1.yaml',
      fingerprint_hash: 'a'.repeat(64),
      params: { username: 'analyst' },
    });
  });

  it('rejects a missing or malformed exact fingerprint', () => {
    expect(() => BrowserReplayCandidateSchema.parse({
      playbook_path: 'browser-b1.yaml', fingerprint_hash: 'short', params: {},
    })).toThrow();
  });
});
