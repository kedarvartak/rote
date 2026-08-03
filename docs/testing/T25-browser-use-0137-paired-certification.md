# T25 — Browser Use 0.13.7 paired corrected-B2 certification

**Date:** 2026-08-03  
**Milestone:** P1 / G2 refresh  
**Protocol:** `p1-g2-fixtures-v3-b2-browser-use-0137-paired`

## Question

After T24 qualified pinned Browser Use 0.13.7, does Rote retain a corrected-B2 efficiency advantage in a fresh, contemporaneously paired certification rather than a comparison against historical Rote rows?

## Frozen method

The protocol file was frozen before collection and before totals were inspected. It fixes:

| Item | Value |
|---|---|
| Task | corrected B2 vendor registration; all eight requested values |
| Pair order | Rote, then Browser Use, for repetitions 1–18 |
| Provider/model | OpenAI `gpt-4.1-mini` |
| Viewport | 1920×1080 |
| Initial URL | `http://127.0.0.1:8080/b2-vendor-form.html` |
| Minimum | 15 successful attempts per harness; 18 planned |
| Browser Use | unmodified 0.13.7; source `f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc`; wheel SHA-256 `2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8` |
| Rote | `c55c492e846a`; ordinary cold agent with managed working context |
| Intervals | deterministic 10,000-resample matched bootstrap; 95% |

Each attempt required both the harness conclusion and a live CDP body containing the exact composite terminal text with company name, email, tax ID, address, city, postal code, country, and phone. Initial navigation was excluded consistently. Failed or interrupted attempts would remain in the denominator; none occurred.

Collection:

```bash
scripts/bench/browser-use-refresh/prepare-venv.sh /tmp/rote-browser-use-0.13.7
export OPENAI_API_KEY=...
scripts/bench/browser-use-refresh/run-certification.sh
```

## Result

All **18/18 Rote attempts** and **18/18 Browser Use attempts** passed both success signals. There were zero observed harness-success/oracle-failure cases.

| Metric | Rote | Browser Use 0.13.7 | Matched reduction (95% CI) |
|---|---:|---:|---:|
| Mean logical tokens/task | 8,352.7 | 49,324.1 | **83.1% [82.1–83.9%]** |
| Mean billed cost/task | $0.0038 | $0.0120 | **68.2% [66.3–69.9%]** |
| Mean latency/task | 19,776.4 ms | 35,084.7 ms | **43.6% [39.0–48.1%]** |

The formal positive-lower-bound G2 gate passes, and the B2 cell clears the catalog’s 80% logical-token target. Latency is reported rather than used as a P1 gate.

## Receipt and verification audit

The frozen evidence retains:

- 18 Rote manifests, 180 trajectory events, and **180 raw OpenAI receipts**;
- 18 Browser Use diagnostic dumps and **74 raw OpenAI receipts**;
- exact cache-aware reconciliation of every receipt to uncached input, cache-read input, cache-write input, and output totals;
- 36 independently verified successes.

Missing or inconsistent usage fails reproduction rather than becoming zero. The report also rejects a Browser Use version other than 0.13.7 for this protocol.

## Conclusion

A fresh corrected-B2 comparison against Browser Use 0.13.7 is certified: under this pinned local fixture, provider, model, and viewport, Rote used fewer logical tokens, cost less, and completed faster at observed exact-success parity. This replaces no historical artifact: Browser Use 0.13.6 T20 remains frozen, and T24 remains a qualification record.

This is one deterministic local workflow. It does **not** establish universal site, provider, model, latency, or task superiority. Both harnesses run here as cold agents. This cell does not evaluate Rote’s separate hand-authored replay path and is not evidence that Rote learns, generates playbooks, or matches a competitor warm-reuse feature.

## Frozen evidence

- [Protocol](data/T25-browser-use-0137-certification-protocol.json)
- [Rote raw run rows](data/T25-browser-use-0137-certification-rote-raw-runs.json)
- [Browser Use raw run rows](data/T25-browser-use-0137-certification-browser-use-raw-runs.json)
- [Reproduced neutral run records](data/T25-browser-use-0137-certification-records.json)
- [Rote manifests](data/T25-browser-use-0137-certification-rote-manifests.json)
- [Rote trajectories and raw receipts](data/T25-browser-use-0137-certification-rote-trajectories.jsonl)
- [Browser Use dumps and raw receipts](data/T25-browser-use-0137-certification-browser-use-dumps.json)
- [Receipt audit](data/T25-browser-use-0137-certification-receipt-audit.json)
- [Deterministic summary](data/T25-browser-use-0137-certification-summary.json)
- [Generated report](data/T25-browser-use-0137-certification-report.md)
