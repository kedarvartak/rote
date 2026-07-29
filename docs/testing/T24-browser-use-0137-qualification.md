# T24 — Browser Use 0.13.7 refresh qualification

**Date:** 2026-07-29

**Protocol:** `browser-use-v0.13.7-b2-b5-qualification-v1`

**Decision:** **QUALIFY corrected B2 for a separate ≥15-run certification.** Do not publish a refreshed Browser Use-vs-Rote performance ranking from these qualification attempts.

## Question

Does the current pinned Browser Use release still execute corrected exact B2 reliably, expose complete provider receipts, and handle the five frozen B5 pages as an ordinary cold re-reasoning control—without rewriting or relabeling historical Browser Use 0.13.6 evidence?

## Frozen configuration

| Item | Value |
|---|---|
| Browser Use release | `0.13.7` |
| Source commit | `f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc` |
| Wheel | `browser_use-0.13.7-py3-none-any.whl` |
| Wheel SHA-256 | `2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8` |
| License | MIT |
| Provider/model | OpenAI `gpt-4.1-mini` |
| Viewport | 1920×1080 |
| Task/oracle | corrected B2 eight-value prompt and exact composite terminal DOM text |
| Cold cap | at most 6 attempts; 3 exact successes required |
| B5 mode | one fresh cold agent run per mutation; no replay/cache equivalence |

The wheel hash was verified before installation into an isolated venv. Browser Use source was not patched, and neither Browser Use nor its benchmark dependency graph ships in `@rote/cli`.

## Method

The adapter reused the same public Browser Use driver that produced historical G2 evidence, including:

- unmeasured initial navigation;
- ordinary default agent behavior with judge disabled;
- independent live-page text capture through Browser Use's public CDP session;
- success only when Browser Use concluded success **and** the exact composite text was visible;
- raw OpenAI receipt retention and provider-neutral cache-bucket normalization.

Qualification stopped after three exact canonical successes. It then ran each B5 mutation once as a new cold agent session: field IDs renamed, submit ID renamed, wrappers/all IDs renamed, destructive stale-selector decoys, and visually ambiguous company controls. These rows measure cold re-observation only. They are not Skyvern-style generated reuse, Stagehand caching, or Rote warm repair.

Collection was append-safe and ordered. A persisted interrupted identity would become `abandoned` with `usage: null` and remain in the denominator rather than being rerun or represented as zero.

## Result

| Audit | Result |
|---|---:|
| Corrected B2 cold exact success | **3/3** (95% Wilson **43.9–100.0%**) |
| Harness-declared B2 cold success | **3/3** |
| Frozen B5 cold exact success | **5/5** |
| Harness-success / oracle-failure | **0** |
| Complete raw provider receipt sets | **8/8** |
| Failed or abandoned official attempts | **0** |

Every normalized usage row reconciled exactly to its retained raw OpenAI call receipts. No missing measurement was converted to zero.

The destructive-decoy and ambiguous fixtures both completed exactly under fresh reasoning. That does not establish a warm-repair or fail-closed capability: Browser Use observed each mutated page from scratch and selected controls in that run.

## Decision and next gate

The adapter clears bounded feasibility, so **corrected B2 is eligible for a separately frozen ≥15-run Browser Use 0.13.7 certification cell**. That future cell must be paired fairly with the existing corrected Rote protocol or a newly frozen Rote collection, retain every failure, and publish matched token/cost/latency intervals only after exact success parity.

T24 itself is only eight attempts across unlike qualification/diagnostic cells. It publishes no refreshed efficiency percentage, cost ranking, latency ranking, or general reliability rate. Browser Use 0.13.6 remains the historical harness behind T10/T11/T13/T20; those artifacts are unchanged.

## Reproduce

```bash
npm run reproduce:browser-use-refresh
```

Live recollection requires an authorized OpenAI key and the isolated environment described in [`scripts/bench/browser-use-refresh/README.md`](../../scripts/bench/browser-use-refresh/README.md).

## Frozen artifacts

- [`T24-browser-use-0137-qualification-receipts.jsonl`](data/T24-browser-use-0137-qualification-receipts.jsonl) — append-only independently graded attempts and raw provider receipts.
- [`T24-browser-use-0137-raw-dumps.json`](data/T24-browser-use-0137-raw-dumps.json) — harness conclusions, final results, URLs, errors, and per-call receipts.
- [`T24-browser-use-0137-qualification-summary.json`](data/T24-browser-use-0137-qualification-summary.json) — machine qualification decision.
- [`T24-browser-use-0137-neutral-records.json`](data/T24-browser-use-0137-neutral-records.json) — diagnostic neutral rows, not a certification ranking.
- [`T24-browser-use-0137-level-report.md`](T24-browser-use-0137-level-report.md) — deterministic generated report.

## Claim boundary

T24 supports only this statement:

> Pinned, unmodified Browser Use 0.13.7 passed 3/3 corrected exact B2 cold attempts and 5/5 frozen B5 cold diagnostics with 8/8 complete raw provider receipt sets and zero observed harness-success/oracle-failure cases. Corrected B2 qualifies for a separate ≥15-run certification; T24 publishes no comparative performance claim.

It does not prove current Browser Use generally, production-site robustness, warm replay/repair, cross-provider behavior, or Rote superiority.
