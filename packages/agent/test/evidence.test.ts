import { describe, expect, it } from 'vitest';
import { digestEvidencePayload, EvidencePolicySchema, type EvidencePolicy } from '@rote/core';
import type { CapturedPage } from '@rote/browser';
import {
  createDownloadEvidenceAdapter,
  createEvidenceGatedVerifier,
  createSnapshotEvidenceAdapter,
  EvidenceCollectionError,
  type EvidenceGatedVerification,
} from '../src/evidence.js';

const subject = { task_id: 'grid-contract', run_id: 'run-1' };
const page: CapturedPage = { url: 'https://fixture.test/', title: 'Fixture', html: '', elements: [] };
const passingBase = { async verify() { return { success: true, summary: 'ui checks passed', checks: [{ text_visible: 'Grid activated' as const }] }; } };

const oraclePolicy: EvidencePolicy = EvidencePolicySchema.parse({
  schema_version: 1,
  required: [{ evidence_class: 'fixture_oracle' }],
});

function oracleAdapter(read: () => Promise<{ payload: unknown; generation?: number } | undefined>) {
  return createSnapshotEvidenceAdapter({
    id: 'fixture-oracle',
    evidenceClass: 'fixture_oracle',
    source: 'http://127.0.0.1/api/oracle',
    read,
    clock: () => 1_000,
  });
}

describe('createEvidenceGatedVerifier', () => {
  it('passes when the base verifier passes and the required evidence is present', async () => {
    const verifier = createEvidenceGatedVerifier({
      base: passingBase,
      policy: oraclePolicy,
      adapters: [oracleAdapter(async () => ({ payload: [{ kind: 'grid_activated' }], generation: 1 }))],
      subject,
      clock: () => 2_000,
      currentGeneration: async () => 1,
    });
    const verification = await verifier.verify(page, 'task', 'done') as EvidenceGatedVerification;
    expect(verification.success).toBe(true);
    expect(verification.consumedEvidence).toHaveLength(1);
    expect(verification.consumedEvidence![0]!.payload_sha256).toMatch(/^[a-f0-9]{64}$/);
    // The base verifier's declarative checks survive the gate so the distiller can learn `verify`.
    expect(verification.checks).toEqual([{ text_visible: 'Grid activated' }]);
  });

  it('keeps the base failure verdict without collecting evidence', async () => {
    let collected = 0;
    const verifier = createEvidenceGatedVerifier({
      base: { async verify() { return { success: false, summary: 'text not visible' }; } },
      policy: oraclePolicy,
      adapters: [oracleAdapter(async () => { collected += 1; return { payload: [] }; })],
      subject,
      clock: () => 2_000,
    });
    expect(await verifier.verify(page, 'task', 'done')).toEqual({ success: false, summary: 'text not visible' });
    expect(collected).toBe(0);
  });

  it('fails closed with a typed classification when the source attests to no effect', async () => {
    const verifier = createEvidenceGatedVerifier({
      base: passingBase,
      policy: oraclePolicy,
      adapters: [oracleAdapter(async () => undefined)],
      subject,
      clock: () => 2_000,
    });
    const verification = await verifier.verify(page, 'task', 'done') as EvidenceGatedVerification;
    expect(verification.success).toBe(false);
    expect(verification.evidenceClassification).toBe('authoritative_effect_missing');
  });

  it('fails closed on generation drift between collection and verification', async () => {
    const verifier = createEvidenceGatedVerifier({
      base: passingBase,
      policy: oraclePolicy,
      adapters: [oracleAdapter(async () => ({ payload: [{ kind: 'grid_activated' }], generation: 1 }))],
      subject,
      clock: () => 2_000,
      currentGeneration: async () => 2,
    });
    const verification = await verifier.verify(page, 'task', 'done') as EvidenceGatedVerification;
    expect(verification.success).toBe(false);
    expect(verification.evidenceClassification).toBe('authoritative_evidence_stale');
  });

  it('throws a typed EvidenceCollectionError when an adapter cannot reach its source', async () => {
    const verifier = createEvidenceGatedVerifier({
      base: passingBase,
      policy: oraclePolicy,
      adapters: [oracleAdapter(async () => { throw new Error('ECONNREFUSED'); })],
      subject,
      clock: () => 2_000,
    });
    await expect(verifier.verify(page, 'task', 'done')).rejects.toThrow(EvidenceCollectionError);
  });

  it('behaves exactly like the base verifier when the policy requires nothing', async () => {
    const verifier = createEvidenceGatedVerifier({
      base: passingBase,
      policy: EvidencePolicySchema.parse({ schema_version: 1, required: [] }),
      adapters: [oracleAdapter(async () => { throw new Error('must not be called'); })],
      subject,
      clock: () => 2_000,
    });
    expect(await verifier.verify(page, 'task', 'done')).toEqual({ success: true, summary: 'ui checks passed', checks: [{ text_visible: 'Grid activated' }] });
  });
});

describe('createDownloadEvidenceAdapter', () => {
  it('pins the exact artifact through the file content digest', async () => {
    const fileSha = digestEvidencePayload('report bytes').sha256;
    const adapter = createDownloadEvidenceAdapter({
      id: 'downloads',
      source: 'cdp:Browser.downloadProgress',
      listDownloads: async () => [{ suggested_filename: 'report.txt', sha256: fileSha, byte_length: 12 }],
      clock: () => 1_000,
    });
    const verifier = createEvidenceGatedVerifier({
      base: passingBase,
      policy: EvidencePolicySchema.parse({
        schema_version: 1,
        required: [{ evidence_class: 'browser_download_event', expected_payload_sha256: fileSha }],
      }),
      adapters: [adapter],
      subject,
      clock: () => 2_000,
    });
    expect((await verifier.verify(page, 'task', 'done')).success).toBe(true);

    const wrongArtifact = createEvidenceGatedVerifier({
      base: passingBase,
      policy: EvidencePolicySchema.parse({
        schema_version: 1,
        required: [{ evidence_class: 'browser_download_event', expected_payload_sha256: 'a'.repeat(64) }],
      }),
      adapters: [adapter],
      subject,
      clock: () => 2_000,
    });
    const verification = await wrongArtifact.verify(page, 'task', 'done') as EvidenceGatedVerification;
    expect(verification.success).toBe(false);
    expect(verification.evidenceClassification).toBe('authoritative_evidence_inconsistent');
  });
});
