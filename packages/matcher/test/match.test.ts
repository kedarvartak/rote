import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildEnvFingerprint, PlaybookSchema, type Playbook } from '@rote/core';
import { intentScore, matchPlaybook, type PlaybookLibraryEntry } from '../src/index.js';

const fingerprint = buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'fixture.test', surface_versions: {} });
const other = buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'prod.example', surface_versions: {} });

function playbook(name: string, intent: string, params: Array<{ name: string; type: 'string' | 'number' | 'boolean' | 'money' }> = [{ name: 'company_name', type: 'string' }], version = 1): Playbook {
  return PlaybookSchema.parse({
    playbook: name, version,
    task_signature: { intent_description: intent, env_fingerprint: { domain: 'fixture.test', tool_prefixes: ['browser.'] } },
    params,
    steps: [{ id: 's', kind: 'deterministic', tool: 'browser.navigate', args: { url: 'https://fixture.test/' } }],
    verify: [{ text_visible: 'ok' }],
  });
}
const entry = (pb: Playbook, hash = fingerprint.fingerprint_hash): PlaybookLibraryEntry => ({ playbook: pb, fingerprint_hash: hash });
const vendor = playbook('b2-vendor', 'Register {{company_name}} as a vendor');
const customer = playbook('b6-customer', 'Register {{company_name}} as a customer');
const request = { task: 'Register Acme Tools as a vendor', params: { company_name: 'Acme Tools' }, envFingerprint: fingerprint };

describe('matcher v1', () => {
  it('slots param values out of the task before scoring, so a same-shape task matches exactly', () => {
    expect(intentScore(request.task, request.params, vendor)).toBe(1);
    // "vendor" is a content token of the customer playbook's intent that the vendor task
    // lacks — coverage fails and the score is 0, not a diluted 0.67.
    expect(intentScore(request.task, request.params, customer)).toBe(0);
    // Dropping a function word or adding one keeps coverage; extra content lowers Jaccard.
    expect(intentScore('Register Acme Tools as vendor', request.params, vendor)).toBeCloseTo(4 / 5, 5);
    expect(intentScore('Please register Acme Tools as a vendor', request.params, vendor)).toBeCloseTo(5 / 6, 5);
    expect(intentScore('Register Acme Tools as a vendor and then delete it', request.params, vendor)).toBeLessThan(0.7);
    expect(matchPlaybook({ ...request, candidates: [entry(vendor)] })).toMatchObject({ kind: 'match', score: 1, bindings: { company_name: 'Acme Tools' }, considered: 1 });
  });

  it('gates on the environment fingerprint before any semantic comparison', () => {
    // A perfect intent match on another environment is not even scored.
    const result = matchPlaybook({ ...request, envFingerprint: other, candidates: [entry(vendor)] });
    expect(result).toEqual({ kind: 'no_match', reason: 'fingerprint_mismatch', considered: 1 });
    expect(matchPlaybook({ ...request, candidates: [] })).toEqual({ kind: 'no_match', reason: 'no_candidates', considered: 0 });
  });

  it('prefers misses: near-miss below the threshold, ambiguity between distinct playbooks, unbindable params', () => {
    // T4 near-miss (docs/03 B6): superficially like B2, genuinely different — must not match.
    expect(matchPlaybook({ ...request, task: 'Register Acme Tools as a customer', candidates: [entry(vendor)] })).toMatchObject({ kind: 'no_match', reason: 'below_threshold', best: { score: 0 } });
    // Two distinct playbooks with the same intent: the task text cannot single one out.
    const twin = playbook('b2-vendor-alt', 'Register {{company_name}} as a vendor');
    expect(matchPlaybook({ ...request, candidates: [entry(vendor), entry(twin)] })).toMatchObject({ kind: 'no_match', reason: 'ambiguous' });
    // Newer version of the *same* playbook is not a rival — it wins.
    const v2 = playbook('b2-vendor', 'Register {{company_name}} as a vendor', undefined, 2);
    expect(matchPlaybook({ ...request, candidates: [entry(vendor), entry(v2)] })).toMatchObject({ kind: 'match', entry: { playbook: { version: 2 } } });
    // A declared param the caller cannot supply disqualifies even a perfect intent.
    const needsTax = playbook('b2-vendor-tax', 'Register {{company_name}} as a vendor', [{ name: 'company_name', type: 'string' }, { name: 'tax_id', type: 'string' }]);
    expect(matchPlaybook({ ...request, candidates: [entry(needsTax)] })).toMatchObject({ kind: 'no_match', reason: 'params_unbound', best: { unbound: ['tax_id'] } });
    // base_url / initial_url are rebound from the live URL and never a match criterion.
    const withBase = playbook('b2-vendor-base', 'Register {{company_name}} as a vendor', [{ name: 'company_name', type: 'string' }, { name: 'base_url', type: 'string' }]);
    expect(matchPlaybook({ ...request, candidates: [entry(withBase)] })).toMatchObject({ kind: 'match' });
  });

  it('never matches across environments, whatever the task text (property)', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 60 }), fc.string({ minLength: 1, maxLength: 60 }), (task, intent) => {
      const result = matchPlaybook({ task, params: {}, envFingerprint: other, candidates: [entry(playbook('p', intent, []))] });
      return result.kind === 'no_match' && result.reason === 'fingerprint_mismatch';
    }));
  });
});
