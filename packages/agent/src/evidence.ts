import {
  buildEvidenceEnvelope,
  evaluateEvidencePolicy,
  VerificationEvidenceEnvelopeSchema,
  type AuthoritativeEvidenceAdapter,
  type EvidencePolicy,
  type EvidencePolicyFailureClassification,
  type EvidenceSubject,
  type VerificationEvidenceEnvelope,
} from '@rote/core';
import type { BrowserAgentVerification, BrowserAgentVerifier } from './types.js';

/**
 * An adapter could not produce evidence (unreachable source, malformed
 * response). This is a broken world, not a clean "no effect" verdict, so it
 * propagates as a typed error instead of a boolean — the run fails loudly
 * rather than classifying an outage as `authoritative_effect_missing`.
 */
export class EvidenceCollectionError extends Error {
  constructor(
    message: string,
    readonly adapterId: string,
    readonly subject: EvidenceSubject,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EvidenceCollectionError';
  }
}

/** Verification result extended with the evidence gate's typed outcome. */
export interface EvidenceGatedVerification extends BrowserAgentVerification {
  /** Present when the gate (not the base verifier) decided the failure. */
  evidenceClassification?: EvidencePolicyFailureClassification;
  /** Redacted envelopes that satisfied the policy, for the run record. */
  consumedEvidence?: readonly VerificationEvidenceEnvelope[];
}

export interface EvidenceGatedVerifierOptions {
  /**
   * The existing verifier (UI text/URL checks, or tagged `verify` model
   * judgment). It remains a necessary condition — but per #130, model judgment
   * and UI state cannot manufacture authoritative evidence, so passing it is
   * never sufficient when the policy requires authoritative classes.
   */
  base: BrowserAgentVerifier;
  policy: EvidencePolicy;
  adapters: readonly AuthoritativeEvidenceAdapter[];
  subject: EvidenceSubject;
  clock: () => number;
  /** Reads the source's current freshness generation at verification time, when it has one. */
  currentGeneration?: () => Promise<number | undefined>;
}

/**
 * Wraps a verifier so success additionally requires the task's declared
 * authoritative evidence. Evaluation order: base verifier first (its failure
 * reason is more specific), then adapter collection, then the pure policy
 * evaluator from `@rote/core`.
 *
 * INVARIANT: every exit either carries `success: false` with a typed reason or
 * throws `EvidenceCollectionError`; no path reports success while a required
 * evidence class is missing, stale, subject-mismatched, or inconsistent
 * (sacred invariant #1).
 */
export function createEvidenceGatedVerifier(options: EvidenceGatedVerifierOptions): BrowserAgentVerifier {
  return {
    async verify(page, task, plannerSummary): Promise<EvidenceGatedVerification> {
      const base = await options.base.verify(page, task, plannerSummary);
      if (!base.success) return base;
      if (options.policy.required.length === 0) return base;

      const envelopes: VerificationEvidenceEnvelope[] = [];
      for (const adapter of options.adapters) {
        let collected: readonly VerificationEvidenceEnvelope[];
        try {
          collected = await adapter.collect(options.subject);
        } catch (error) {
          throw new EvidenceCollectionError(
            `evidence adapter "${adapter.id}" failed for task "${options.subject.task_id}"`,
            adapter.id,
            options.subject,
            error,
          );
        }
        for (const envelope of collected) {
          const parsed = VerificationEvidenceEnvelopeSchema.safeParse(envelope);
          if (!parsed.success) {
            throw new EvidenceCollectionError(
              `evidence adapter "${adapter.id}" returned a malformed envelope: ${parsed.error.message}`,
              adapter.id,
              options.subject,
              parsed.error,
            );
          }
          envelopes.push(parsed.data);
        }
      }

      const currentGeneration = options.currentGeneration ? await options.currentGeneration() : undefined;
      const verdict = evaluateEvidencePolicy(options.policy, envelopes, {
        subject: options.subject,
        now_ms: options.clock(),
        ...(currentGeneration === undefined ? {} : { current_generation: currentGeneration }),
      });
      if (verdict.satisfied) {
        return {
          success: true,
          summary: `${base.summary}; authoritative evidence satisfied (${verdict.consumed.length} envelope(s))`,
          ...(base.checks ? { checks: base.checks } : {}),
          consumedEvidence: verdict.consumed,
        };
      }
      return {
        success: false,
        summary: `authoritative evidence gate failed: ${verdict.classification} — ${verdict.detail}`,
        evidenceClassification: verdict.classification,
      };
    },
  };
}

/**
 * Adapter over any injected point-in-time state reader (API endpoint, database
 * query, fixture oracle). The reader owns the side effect; this factory owns
 * redaction: the payload is digested into the envelope and discarded. A reader
 * returning `undefined` means the source attests to no effect for this subject,
 * so no envelope is emitted and the policy evaluator reports
 * `authoritative_effect_missing`.
 */
export function createSnapshotEvidenceAdapter(options: {
  id: string;
  evidenceClass: 'api_state' | 'database_state' | 'fixture_oracle';
  /** Provenance descriptor (endpoint, store name) recorded on every envelope. */
  source: string;
  read: (subject: EvidenceSubject) => Promise<{ payload: unknown; generation?: number } | undefined>;
  clock: () => number;
}): AuthoritativeEvidenceAdapter {
  return {
    id: options.id,
    async collect(subject) {
      const snapshot = await options.read(subject);
      if (snapshot === undefined) return [];
      return [buildEvidenceEnvelope({
        evidence_class: options.evidenceClass,
        adapter_id: options.id,
        source: options.source,
        subject,
        collected_at_ms: options.clock(),
        ...(snapshot.generation === undefined ? {} : { freshness_generation: snapshot.generation }),
        payload: snapshot.payload,
      })];
    },
  };
}

/** One completed browser-native download, digested at the browser edge. */
export interface DownloadEvidenceRecord {
  suggested_filename: string;
  /** Digest of the downloaded bytes, computed where the bytes live — never shipped here. */
  sha256: string;
  byte_length: number;
}

/**
 * Adapter over an injected browser download listing. The file content digest
 * *is* the payload digest, so a policy pins the exact expected artifact via
 * `expected_payload_sha256` without the file bytes entering any record.
 */
export function createDownloadEvidenceAdapter(options: {
  id: string;
  source: string;
  listDownloads: (subject: EvidenceSubject) => Promise<readonly DownloadEvidenceRecord[]>;
  clock: () => number;
}): AuthoritativeEvidenceAdapter {
  return {
    id: options.id,
    async collect(subject) {
      const downloads = await options.listDownloads(subject);
      return downloads.map((download) => VerificationEvidenceEnvelopeSchema.parse({
        schema_version: 1,
        evidence_class: 'browser_download_event',
        adapter_id: options.id,
        source: `${options.source}#${download.suggested_filename}`,
        subject,
        collected_at_ms: options.clock(),
        payload_sha256: download.sha256,
        payload_byte_length: download.byte_length,
      }));
    },
  };
}
