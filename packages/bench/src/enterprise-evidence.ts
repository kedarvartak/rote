import {
  buildEvidenceEnvelope,
  type AuthoritativeEvidenceAdapter,
  type EvidenceSubject,
} from '@rote/core';
import { EnterpriseOracleSnapshotSchema } from './enterprise-oracle.js';

// see docs/02-architecture.md "Enterprise browser contracts" — step 4 (#130):
// E7.1 corpus outcomes may pass only from their frozen authoritative source.

/**
 * Binds the E7.1 fixture oracle (`/api/oracle`) into the E7.4 evidence
 * contract. The snapshot's own `task_id` — not the requesting subject's — is
 * stamped into the envelope, so a snapshot answering for another task surfaces
 * as `authoritative_evidence_task_mismatch` instead of silently satisfying the
 * policy. A snapshot with zero events emits no envelope: "the source attests
 * to no effect" must evaluate as `authoritative_effect_missing`, which is a
 * different verdict from an unreachable oracle (that throws).
 */
export function createEnterpriseOracleEvidenceAdapter(options: {
  id: string;
  /** Builds the generation-unpinned oracle URL for a subject's task. */
  oracleUrl: (subject: EvidenceSubject) => string;
  /** Injected transport; must reject on non-2xx or malformed JSON. */
  fetchJson: (url: string) => Promise<unknown>;
  clock: () => number;
}): AuthoritativeEvidenceAdapter {
  return {
    id: options.id,
    async collect(subject) {
      const url = options.oracleUrl(subject);
      const snapshot = EnterpriseOracleSnapshotSchema.parse(await options.fetchJson(url));
      if (snapshot.events.length === 0) return [];
      return [buildEvidenceEnvelope({
        evidence_class: 'fixture_oracle',
        adapter_id: options.id,
        source: url,
        subject: { task_id: snapshot.task_id, run_id: subject.run_id },
        collected_at_ms: options.clock(),
        freshness_generation: snapshot.generation,
        // Events already carry digests instead of dispatched values, so this
        // envelope digest is a redacted digest-of-digests.
        payload: snapshot.events,
      })];
    },
  };
}
