import { describe, expect, it } from 'vitest';
import { fingerprintFromToolsList } from '../src/fingerprint-session.js';

describe('fingerprintFromToolsList', () => {
  it('produces the same hash regardless of tool order', () => {
    const a = fingerprintFromToolsList(
      { tools: [{ name: 'b', inputSchema: {} }, { name: 'a', inputSchema: {} }] },
      'demo.example.com',
    );
    const b = fingerprintFromToolsList(
      { tools: [{ name: 'a', inputSchema: {} }, { name: 'b', inputSchema: {} }] },
      'demo.example.com',
    );
    expect(a.fingerprint_hash).toBe(b.fingerprint_hash);
  });

  it('produces a different hash when a tool schema changes', () => {
    const a = fingerprintFromToolsList(
      { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] },
      'demo.example.com',
    );
    const b = fingerprintFromToolsList(
      { tools: [{ name: 'echo', inputSchema: { type: 'string' } }] },
      'demo.example.com',
    );
    expect(a.fingerprint_hash).not.toBe(b.fingerprint_hash);
  });

  it('produces a different hash for a different target identity', () => {
    const a = fingerprintFromToolsList({ tools: [] }, 'demo.example.com');
    const b = fingerprintFromToolsList({ tools: [] }, 'other.example.com');
    expect(a.fingerprint_hash).not.toBe(b.fingerprint_hash);
  });
});
