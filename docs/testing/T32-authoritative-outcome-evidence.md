# T32 — Authoritative outcome evidence

**Date:** 2026-08-12  
**Milestone:** P2 / E7.4  
**Source:** issue #130; E7.1 protocol `p2-enterprise-contract-corpus-v1`

## Question

Can task success be made conditional on evidence from an independent system of record —
so that harness conclusion, passing UI checks, generic DOM mutation, stale evidence, and
evidence recorded for another task or run all fail with typed classifications — without
banning UI evidence as support and without any credential or dispatched value entering an
evidence record?

This is a deterministic contract qualification against the frozen E7.1 fixture oracle. It
is not production API/database certification, expanded action vocabulary (E7.5), or
structural action-contract compatibility (#143).

## Contract

A version-1 verification evidence envelope (`@rote/core`) carries evidence class, adapter
provenance, subject binding (task + run), injected-clock collection time, an optional
source freshness generation, and a payload **digest** — the schema is `strict`, so a raw
payload, `value`, or credential field fails parse instead of persisting.

- Policies (`EvidencePolicySchema`) may require only authoritative classes
  (`api_state`, `database_state`, `fixture_oracle`, `browser_download_event`);
  `ui_text`/`ui_url` are representable as evidence but unrequirable by construction.
- The pure evaluator classifies, per requirement and in order:
  `authoritative_effect_missing` → `authoritative_evidence_task_mismatch` →
  `authoritative_evidence_stale` → `authoritative_evidence_inconsistent`.
- `createEvidenceGatedVerifier` (`@rote/agent`) keeps the injected base verifier — UI
  checks or tagged `verify` model judgment — as a necessary condition; neither can
  manufacture authoritative evidence. An empty `required` list preserves existing
  behavior exactly, so B1–B3 verification is unchanged.
- An unreachable or malformed source **throws** `EvidenceCollectionError`; "could not
  check" is never classified as "no effect".
- The E7.1 oracle adapter (`@rote/bench`) stamps the snapshot's own `task_id` into the
  envelope subject and emits no envelope for an empty snapshot.

## Deterministic results

| Control | Result |
|---|---:|
| Full-loop: planner success + passing UI verifier, no oracle event | fails, `authoritative_effect_missing` |
| Full-loop: evidence recorded for another task or run | fails, `authoritative_evidence_task_mismatch` |
| Full-loop: oracle generation advanced past collection (fixture reset) | fails, `authoritative_evidence_stale` |
| Pinned digest mismatch (wrong download artifact / wrong state) | fails, `authoritative_evidence_inconsistent` |
| Oracle attests the exact effect at the current generation | passes |
| Unreachable oracle | typed `EvidenceCollectionError`, never success |
| Live E7.1 fixture-server round-trip (post event → satisfy; reset → stale) | passes |
| Envelope carrying raw payload / `value` / `credentials` field | schema parse rejected |
| Property: any volume of other-class (incl. UI) evidence vs. a required class | never satisfied |
| Empty policy | byte-identical base verifier behavior (B1–B3 compatible) |

## Reproduce

```bash
npx vitest run packages/core/test/verification-evidence.test.ts \
  packages/agent/test/evidence.test.ts \
  packages/agent/test/invariants/authoritative-evidence-gates-success.test.ts \
  packages/bench/test/enterprise-evidence.test.ts
```

The bench suite starts a real `EnterpriseFixtureServer` on loopback; no browser, network,
or provider key is required. Production API/database adapters are injected implementations
of the same `AuthoritativeEvidenceAdapter` interface and remain deployment-specific.
