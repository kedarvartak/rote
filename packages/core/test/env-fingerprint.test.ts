import { describe, it, expect } from 'vitest';
import { buildEnvFingerprint } from '../src/schemas/env-fingerprint.js';

describe('buildEnvFingerprint', () => {
  const base = {
    tool_inventory: [
      { name: 'browser.navigate', schema_hash: 'abc' },
      { name: 'browser.fill', schema_hash: 'def' },
    ],
    target_identity: 'vendors.acme.com',
    surface_versions: { chromium: '120' },
  };

  it('is stable regardless of tool_inventory order', () => {
    const reordered = { ...base, tool_inventory: [...base.tool_inventory].reverse() };
    expect(buildEnvFingerprint(base).fingerprint_hash).toBe(
      buildEnvFingerprint(reordered).fingerprint_hash,
    );
  });

  it('changes when a tool schema_hash changes', () => {
    const changed = {
      ...base,
      tool_inventory: base.tool_inventory.map((t) =>
        t.name === 'browser.fill' ? { ...t, schema_hash: 'CHANGED' } : t,
      ),
    };
    expect(buildEnvFingerprint(base).fingerprint_hash).not.toBe(
      buildEnvFingerprint(changed).fingerprint_hash,
    );
  });

  it('changes when target_identity changes', () => {
    const changed = { ...base, target_identity: 'other.example.com' };
    expect(buildEnvFingerprint(base).fingerprint_hash).not.toBe(
      buildEnvFingerprint(changed).fingerprint_hash,
    );
  });

  it('changes when a tool is added or removed', () => {
    const withExtra = {
      ...base,
      tool_inventory: [...base.tool_inventory, { name: 'browser.click', schema_hash: 'ghi' }],
    };
    expect(buildEnvFingerprint(base).fingerprint_hash).not.toBe(
      buildEnvFingerprint(withExtra).fingerprint_hash,
    );
  });

  it('produces a 64-character lowercase hex hash', () => {
    const { fingerprint_hash } = buildEnvFingerprint(base);
    expect(fingerprint_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
