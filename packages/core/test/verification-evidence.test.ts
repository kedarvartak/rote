import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_EVIDENCE_CLASSES,
  buildEvidenceEnvelope,
  digestEvidencePayload,
  evaluateEvidencePolicy,
  EvidencePolicySchema,
  isAuthoritativeEvidenceClass,
  VerificationEvidenceEnvelopeSchema,
  type EvidencePolicy,
  type VerificationEvidenceEnvelope,
} from '../src/index.js';

const subject = { task_id: 'grid-contract', run_id: 'run-1' };

function envelope(overrides: Partial<VerificationEvidenceEnvelope> = {}): VerificationEvidenceEnvelope {
  const base = buildEvidenceEnvelope({
    evidence_class: 'fixture_oracle',
    adapter_id: 'oracle',
    source: 'http://127.0.0.1/api/oracle?task_id=grid-contract',
    subject,
    collected_at_ms: 1_000,
    freshness_generation: 3,
    payload: [{ kind: 'grid_activated', target_key: 'row-7' }],
  });
  return { ...base, ...overrides };
}

const policy: EvidencePolicy = EvidencePolicySchema.parse({
  schema_version: 1,
  required: [{ evidence_class: 'fixture_oracle' }],
});

describe('VerificationEvidenceEnvelopeSchema', () => {
  it('rejects an envelope carrying a raw payload or credential-shaped field', () => {
    for (const leak of [{ payload: { secret: 'hunter2' } }, { value: 'hunter2' }, { credentials: 'token' }]) {
      expect(VerificationEvidenceEnvelopeSchema.safeParse({ ...envelope(), ...leak }).success).toBe(false);
    }
  });

  it('accepts only lowercase 64-hex digests', () => {
    expect(VerificationEvidenceEnvelopeSchema.safeParse(envelope({ payload_sha256: 'ABC' })).success).toBe(false);
  });

  it('keeps ui classes representable as evidence but never requirable by a policy', () => {
    expect(isAuthoritativeEvidenceClass('ui_text')).toBe(false);
    expect(EvidencePolicySchema.safeParse({
      schema_version: 1,
      required: [{ evidence_class: 'ui_text' }],
    }).success).toBe(false);
  });
});

describe('digestEvidencePayload', () => {
  it('is key-order independent so equal states compare equal', () => {
    expect(digestEvidencePayload({ a: 1, b: [{ x: 1, y: 2 }] }))
      .toEqual(digestEvidencePayload({ b: [{ y: 2, x: 1 }], a: 1 }));
  });

  it('distinguishes different states', () => {
    expect(digestEvidencePayload({ a: 1 }).sha256).not.toBe(digestEvidencePayload({ a: 2 }).sha256);
  });
});

describe('evaluateEvidencePolicy', () => {
  const binding = { subject, now_ms: 2_000, current_generation: 3 };

  it('is satisfied by a fresh subject-bound envelope of the required class', () => {
    const verdict = evaluateEvidencePolicy(policy, [envelope()], binding);
    expect(verdict).toMatchObject({ satisfied: true });
  });

  it('reports authoritative_effect_missing when the class was never collected', () => {
    expect(evaluateEvidencePolicy(policy, [], binding))
      .toMatchObject({ satisfied: false, classification: 'authoritative_effect_missing' });
  });

  it('reports task mismatch when evidence exists only for another task or run', () => {
    const otherTask = envelope({ subject: { task_id: 'other-contract', run_id: 'run-1' } });
    const otherRun = envelope({ subject: { task_id: 'grid-contract', run_id: 'run-2' } });
    for (const foreign of [otherTask, otherRun]) {
      expect(evaluateEvidencePolicy(policy, [foreign], binding))
        .toMatchObject({ satisfied: false, classification: 'authoritative_evidence_task_mismatch' });
    }
  });

  it('reports stale when the generation shifted or the envelope has no generation under a generation-bound evaluation', () => {
    expect(evaluateEvidencePolicy(policy, [envelope({ freshness_generation: 2 })], binding))
      .toMatchObject({ satisfied: false, classification: 'authoritative_evidence_stale' });
    const withoutGeneration = { ...envelope() } as Record<string, unknown>;
    delete withoutGeneration['freshness_generation'];
    expect(evaluateEvidencePolicy(policy, [VerificationEvidenceEnvelopeSchema.parse(withoutGeneration)], binding))
      .toMatchObject({ satisfied: false, classification: 'authoritative_evidence_stale' });
  });

  it('reports stale when the envelope exceeds max_age_ms', () => {
    const aged = EvidencePolicySchema.parse({ ...policy, max_age_ms: 500 });
    expect(evaluateEvidencePolicy(aged, [envelope()], { subject, now_ms: 10_000, current_generation: 3 }))
      .toMatchObject({ satisfied: false, classification: 'authoritative_evidence_stale' });
  });

  it('reports inconsistent when a pinned digest does not match', () => {
    const pinned = EvidencePolicySchema.parse({
      schema_version: 1,
      required: [{ evidence_class: 'fixture_oracle', expected_payload_sha256: 'f'.repeat(64) }],
    });
    expect(evaluateEvidencePolicy(pinned, [envelope()], binding))
      .toMatchObject({ satisfied: false, classification: 'authoritative_evidence_inconsistent' });
  });

  it('passes a pinned digest computed from the expected payload', () => {
    const expected = digestEvidencePayload([{ kind: 'grid_activated', target_key: 'row-7' }]).sha256;
    const pinned = EvidencePolicySchema.parse({
      schema_version: 1,
      required: [{ evidence_class: 'fixture_oracle', expected_payload_sha256: expected }],
    });
    expect(evaluateEvidencePolicy(pinned, [envelope()], binding)).toMatchObject({ satisfied: true });
  });

  // INVARIANT: no volume of evidence of other classes — UI included — satisfies
  // a required authoritative class (sacred invariant #1).
  it('property: is never satisfied when the required class is absent, regardless of other evidence', () => {
    const otherClassArb = fc.constantFrom('ui_text', 'ui_url', 'api_state', 'database_state', 'browser_download_event') as fc.Arbitrary<
      Exclude<VerificationEvidenceEnvelope['evidence_class'], 'fixture_oracle'>
    >;
    fc.assert(fc.property(
      fc.array(fc.record({ evidence_class: otherClassArb, payload: fc.jsonValue() }), { maxLength: 12 }),
      (others) => {
        const envelopes = others.map((other) => buildEvidenceEnvelope({
          evidence_class: other.evidence_class,
          adapter_id: 'other',
          source: 'somewhere',
          subject,
          collected_at_ms: 1_500,
          freshness_generation: 3,
          payload: other.payload,
        }));
        const verdict = evaluateEvidencePolicy(policy, envelopes, binding);
        return verdict.satisfied === false && verdict.classification === 'authoritative_effect_missing';
      },
    ));
  });

  it('property: requirement order determines which failure classifies the verdict deterministically', () => {
    fc.assert(fc.property(fc.constantFrom(...AUTHORITATIVE_EVIDENCE_CLASSES), (missingClass) => {
      const twoClassPolicy = EvidencePolicySchema.parse({
        schema_version: 1,
        required: [{ evidence_class: missingClass }],
      });
      const verdict = evaluateEvidencePolicy(twoClassPolicy, [], binding);
      return !verdict.satisfied && verdict.detail.includes(missingClass);
    }));
  });
});
