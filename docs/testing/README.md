# Testing log

Numbered records of tests run against **real** Rote — live browser, live model,
live API key. One document per test, written for a reader who arrives cold in six
months and needs to know what we did, what happened, and what we concluded.

These are not unit tests. The deterministic fake-world suite lives with the code
(`packages/*/test/`) and runs in CI on every PR. This folder is for the tests CI
*cannot* run: the ones that cost money, launch a browser, and tell us whether the
software actually works.

## Why this folder exists

`docs/03` requires that we publish method and raw data, not just numbers —
"credibility in this space comes from reproducibility". A test whose method is
undocumented is a claim, not evidence. Each record states its method precisely
enough to be re-run and disagreed with.

## Conventions

- **`T<N>-<slug>.md`**, numbered in the order the tests were run. Never renumber:
  issues and commits cite these ids.
- Every record carries: date, what was tested, **exactly how** (commands, models,
  fixture versions), what happened, what we concluded, and what must change.
- **Record what actually happened, including our own mistakes.** A test log that
  only contains successes is marketing. Failures, wrong turns, and corrections are
  the parts with information in them.
- Numbers carry units. Token counts say input/output. Prices name the model.
- Findings that need work become GitHub issues; the record links them, and the
  issue links back.

## Records

| Test | Date | Subject | Outcome |
|---|---|---|---|
| [T1](T1-openai-dry-run.md) | 2026-07-15 | First live run of the B1–B3 fixtures on a real OpenAI key | B1/B3 pass; **B2 fails 0/7** on a design flaw → #49 #50 #51 #52 |
| [T2](T2-measurement-page-selection.md) | 2026-07-17 | Select and validate P1's real measurement page | Digest-pinned WordPress selected; exactly 120 benchmark posts, 22,279 approximate tokens with zero range across 15 fresh measured sessions after one declared warm-up |
| [T3](T3-rote-openai-exploratory.md) | 2026-07-22 | One Rote run at each real-page curve checkpoint | 7/10-step cells pass; 15/20/25 fail; A4 diffs are 24–89 characters; explicitly not comparison evidence |
| [T4](T4-openai-cache-layout.md) | 2026-07-22 | Qualify append-only history ordering against OpenAI automatic caching | WP-N15 passes 2/2; both runs report a 1,024-token incremental cache read; economics remain unmeasured |
| [T5](T5-browser-use-completion.md) | 2026-07-22 | Prevent post-Apply disappearance from causing a false Browser Use conclusion | Fresh v4 WP-N07 pair passes in 7 calls/harness; instrument smoke only |
| [T6](T6-wordpress-corpus-cleanup.md) | 2026-07-22 | Remove WordPress's unrelated stock post and gate the exact 120-title corpus | Stability remains zero-range; fresh v5 WP-N10 pair passes; instrument smoke only |
| [T7](T7-browser-use-long-cell-qualification.md) | 2026-07-22 | Bound Browser Use exact-set long-cell reliability before certification | N15 can pass with accessible labels; N20 fails safely; bulk-checkbox long cells are a no-go |
| [T8](T8-title-review-curve-smokes.md) | 2026-07-22 | Test non-checkbox title-review replacements across the full curve | Superseded by T9 after certification exposed 3/10 failures |
| [T9](T9-certification-stop-and-tag-qualification.md) | 2026-07-23 | Stop unreliable v7 collection and qualify safe tag creation | Retain all v7 failures; v8 passes 30/30 bounded sessions across five cells |
| [T10](T10-g1-cumulative-token-curve.md) | 2026-07-23 | Certify and publish G1 on the frozen v8 protocol | 37.2% slower logical-input growth (95% CI 35.6–38.8%); 75/75 verified successes per harness; frozen cost/latency do not win |
| [T11](T11-cache-key-economics.md) | 2026-07-23 | Qualify deterministic immutable-prefix routing in a fresh paired matrix | WP-N25 Rote cost −20.5% vs frozen and −16.0% vs Browser Use; WP-N09 still crosses parity |
| [T12](T12-g2-b1-b3-instrument-smoke.md) | 2026-07-24 | Freeze B1–B3 and qualify the cache-aware append-safe G2 instrument | historical smoke; T19 later finds B2's configured completion oracle was not field-exact |
| [T13](T13-g2-certification.md) | 2026-07-24 | Preserve the frozen B1–B3 v1 matrix | B1/B3 evidence stands; historical B2 row is superseded by T20 |
| [T14](T14-cli-package-candidate.md) | 2026-07-24 | Prove the 0.1.0 CLI tarball installs and runs without the monorepo | clean pack/bin and live B1 pass; registry publish blocked on npm scope ownership/auth |
| [T15](T15-replay-fallback.md) | 2026-07-24 | Exercise the invariant-2 exit after an exact-fingerprint replay assertion fails | failed replay remains failed; classified cold fallback completes and verifies B1 |
| [T16](T16-launch-demo.md) | 2026-07-24 | Record the shipped product boundary from cold exploration through replay and real selector drift | cold verifies; explicit replay uses zero tokens; stale replay fails and classified cold fallback verifies |
| [T17](T17-one-command-reproduction.md) | 2026-07-24 | Make paid G2 collection and no-provider published-evidence reproduction one command each | byte-identical T13 reproduction passes; fresh post-package B1 pair verifies both source runners |
| [T18](T18-eviction-recall-trade.md) | 2026-07-26 | Stress the tier-0 recall trade across two pages in the sacred invariant suite | missing recall declines with `recall_unavailable`; fabricated comparison fails verification |
| [T19](T19-b2-exact-verification.md) | 2026-07-26 | Replace B2's generic completion oracle with all eight exact values | historical B2 claim withdrawn; corrected Rote/Browser Use pair passes qualification |
| [T20](T20-b2-exact-certification.md) | 2026-07-27 | Certify corrected B2 under the retained eight-value live oracle | 36/36 exact successes; 83.6% token reduction (95% CI 82.7–84.6%); full G2 restored |
| [T21](T21-b5-drift-certification.md) | 2026-07-27 | Grade deterministic B2 selector drift, destructive decoys, ambiguity, silent failure, and repair cost | 72/72 repaired exact successes; 0/90 observed silent failures; 18/18 ambiguity fallbacks; zero repair tokens |
| [T22](T22-stagehand-qualification.md) | 2026-07-28 | Qualify pinned Stagehand 3.7.1 on exact B2 and B5 before certification spend | stop: 1/6 exact cold successes, 7 harness-success/oracle-failure cases, incomplete cold receipts; no comparative claim |
| [T23](T23-skyvern-qualification.md) | 2026-07-28 | Qualify pinned Skyvern 1.0.47 cold preparation and generated-code warm/drift execution before certification spend | stop: 4/4 exact cold, 3 exact pairs, 23/23 completed warm/drift exact, but 24/24 fallback and 0/28 complete raw provider receipts; no comparative ranking |
| [T24](T24-browser-use-0137-qualification.md) | 2026-07-29 | Refresh Browser Use to pinned 0.13.7 on corrected B2 and frozen B5 before certification spend | qualify corrected B2 for a separate ≥15-run cell: 3/3 B2 exact, 5/5 B5 cold exact, 8/8 complete provider receipt sets; no performance claim |
| [T25](T25-browser-use-0137-paired-certification.md) | 2026-08-03 | Recollect Rote and pinned Browser Use 0.13.7 contemporaneously on corrected B2 | 18/18 exact successes per harness; Rote reduces logical tokens 83.1% [82.1–83.9%], billed cost 68.2% [66.3–69.9%], and latency 43.6% [39.0–48.1%] |
| [T26](T26-post-action-evidence-qualification.md) | 2026-08-03 | Qualify zero-LLM observed action effects on fresh canonical B1–B3 runs and decide generic click enforcement | 9/9 exact successes; 33/33 strong effects, 15 shadow click reactions, 57/57 receipts, zero repairs; generic click reaction remains non-enforcing |
| [T27](T27-magnitude-qualification.md) | 2026-08-04 | Qualify integrity-pinned Magnitude 0.3.1 cold vision execution on corrected B2 before certification spend | stop: 0/6 exact and harness conclusions, 6/6 frozen timeouts, 0/6 complete raw receipt sets; no B5 or comparative ranking |
| [T28](T28-registry-provider-quickstart.md) | 2026-08-08 | Run public `@rotehq/cli@0.1.0` from an empty directory with one provider key | pass: registry bytes match the audited artifact; one-step cold run independently verifies visible text; manifest, trajectory, and raw OpenAI receipt reconcile |
| [T29](T29-enterprise-contract-corpus.md) | 2026-08-08 | Freeze E7.1 adversarial enterprise fixtures and exact external oracles before mechanisms | 19 synthetic cases frozen; schema/oracle tests and repeated real-Chrome fixture control smoke pass; no enterprise-readiness claim |
| [T30](T30-target-identity-v2.md) | 2026-08-10 | Qualify context/container-aware target identity before traversal or learning | 100/100 property cases and 2/2 real-Chrome repetitions pass; repeated keyed rows remain distinct/stable, values stay excluded, residual ambiguity fails closed |
