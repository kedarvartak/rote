# P1 launch readiness

**Decision updated 2026-08-08: LAUNCHED — all P1 release gates pass.**

T20 corrects B2 with 18/18 exact-oracle successes per harness; T25 separately refreshes
corrected B2 against Browser Use 0.13.7 with 18/18 fresh exact successes per harness. T21
passes deterministic target-drift recovery. `@rotehq/cli@0.1.0` is npm-published, its
registry bytes match the audited source artifact, and T28 completes the provider-backed
registry quickstart from an empty directory.

## Gate walk

| Gate | Status | Evidence |
|---|---|---|
| G1 real-page curve | pass | [T10](testing/T10-g1-cumulative-token-curve.md): lower 95% slope-reduction bound 35.6%, above 30%, at 75/75 parity per harness |
| OpenAI cache economics | qualified with short-cell loss | [T11](testing/T11-cache-key-economics.md): WP-N25 cost win; WP-N09 interval crosses parity |
| G2 tokens/task level | **pass, corrected and refreshed** | B1/B3 retain exact 0.13.6 parity evidence; T20 restores corrected B2 historically, and T25 separately certifies 83.1% lower logical tokens (95% CI 82.1–83.9%) against 0.13.7 at 18/18 fresh exact parity per harness |
| CLI package shape | pass | [T14](testing/T14-cli-package-candidate.md): build, pack, clean install, bin, live data URL and B1 |
| Registry-backed provider quickstart | **pass** | [T28](testing/T28-registry-provider-quickstart.md): empty-directory `npx @rotehq/cli@0.1.0`, independent visible-text verification, exact registry integrity, manifest, trajectory, and reconciled raw receipt |
| Eviction recall trade | fail-closed, task remains unsupported | [T18](testing/T18-eviction-recall-trade.md): missing fact is `recall_unavailable`; fabricated answer is `verification_failed` |
| Failed replay fallback | pass with rollback limit | [T15](testing/T15-replay-fallback.md): failed cheap path remains failed; cold fallback verifies |
| Runnable terminal demo | pass | [T16](testing/T16-launch-demo.md): cold → explicit zero-token replay → real drift detection/full fallback |
| One-command evidence reproduction | pass in CI | [T17](testing/T17-one-command-reproduction.md): T13 Markdown/JSON byte-identical |
| Known limitations | published | [Known limitations](known-limitations.md) linked from README |
| Competitor/dependency license review | pass | [Third-party review](third-party-licenses.md): Browser Use is an unmodified MIT dependency, not a fork |
| Typecheck, lint, sacred invariants, package/script tests | pass | mandatory CI |

## Release closure

1. [x] Confirm maintainer ownership of `rotehq` and freeze `@rotehq/cli`.
2. [x] Build, test, pack, and audit the seven-file tarball from source commit
   `5564443558c9eb9e48d29ff1aca80d205cf0d32b`.
3. [x] Publish `@rotehq/cli@0.1.0` with public access; registry integrity and shasum match.
4. [x] Invoke the registry-backed bin without a provider key in an empty directory.
5. [x] Run the README data-URL command through registry-backed `npx` with only an OpenAI
   key; independently verify live visible text and retain a valid manifest/trajectory.
6. [x] Publish [T28](testing/T28-registry-provider-quickstart.md), reconcile the raw receipt,
   and close #107.

## Claims that did not expand at launch

P1 is one pinned tier-0 release, not a universal benchmark result. It does not establish
cross-provider/model or broad production-site generality, vision, arbitrary workflow
repair, transactional rollback, learned matching, or automated distillation. B4
compaction was built after the immutable 0.1.0 artifact and still awaits E7.6's 50+ step
provider/SPA qualification. See [known limitations](known-limitations.md).
