# T13 — G2 B1–B3 certification

## Decision

**G2 passes its frozen formal gate on all three tasks.** Rote and Browser Use each
completed and independently verified all 54 attempts. Every matched-repetition 95%
logical-token interval remains above zero.

B1 and B3 also clear the benchmark catalog's 80% reduction target. **B2 does not:** its
lower bound is 76.9%, though it remains above the 50% kill threshold. This is a positive
G2 result, not an honest basis for saying every task saves at least 80%.

| Task | Logical tokens/task reduction (95% CI) | Cost/task reduction (95% CI) | Latency reduction (95% CI) | Success R/B |
|---|---:|---:|---:|---:|
| B1 authenticated download | **91.8% [91.8–91.9%]** | 82.3% [82.1–82.5%] | 47.6% [44.3–50.7%] | 18/18 / 18/18 |
| B2 long form | **77.3% [76.9–78.1%]** | 56.2% [54.7–58.1%] | 13.9% [3.1–22.3%] | 18/18 / 18/18 |
| B3 search/open | **93.3% [92.4–93.9%]** | 85.4% [83.6–86.6%] | 55.5% [51.3–58.8%] | 18/18 / 18/18 |

“Logical tokens” here means uncached input + cache-read input + cache-write input +
output. Dollars price those buckets separately using the dated 2026-07-15 table. Latency
is reported rather than gated in V1. None of these cells reaches the catalog's 5× latency
pass target; B1 and B2 remain below its 2× kill line, while B3 is between the two.

## Frozen method

| Control | Value |
|---|---|
| Protocol | `p1-g2-fixtures-v1-b1-b3` |
| Subject | Rote at merge `bcd9b12` (#102) |
| Baseline | Browser Use 0.13.6, unmodified dependency |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Viewport | 1920×1080 |
| Attempts | 18 repetitions × 3 tasks × 2 harnesses = 108 |
| Order | repetition outer; B1→B3; Rote→Browser Use within each pair |
| Intervals | matched-repetition bootstrap, fixed seeds, 10,000 resamples, 95% |
| Success | harness conclusion and fixture text independently visible on the live page |

Both harnesses received the same task, fixture state, initial URL, model, and viewport.
Initial navigation was unmeasured on both sides. Browser Use used its defaults with the
judge disabled; no prompts were shortened and no hidden custom cache was added. The
collector wrote one atomic pair at a time and retained failed attempts in place, though
this matrix had none.

## Verification audit

The report command cross-checks all neutral record identities against 54 Rote manifests
and 54 Browser Use diagnostic dumps. A Rote success requires its fail-closed executor
manifest outcome. A Browser Use success requires both `is_successful: true` and the exact
fixture verification text captured over live CDP before teardown. Its 163 raw provider
receipts retain the model and provider usage objects; missing or impossible receipt
layouts fail collection.

Rote mean logical tokens by source were planner-only: B1 2,835.6, B2 8,248.2, and B3
2,319.0 tokens/run. No repair or verification LLM call was needed in this matrix.

## Reproduction and evidence

Rebuild the audited report:

```bash
node packages/bench/bin/rote-bench.js g2-report \
  docs/testing/data/T13-g2-records.json \
  --rote-manifests docs/testing/data/T13-g2-rote-manifests.json \
  --browser-dumps docs/testing/data/T13-g2-browser-use-dumps.json \
  --out /tmp/g2.md --summary /tmp/g2.json --min-runs 15
cmp /tmp/g2.md docs/testing/T13-g2-level-report.md
cmp /tmp/g2.json docs/testing/data/T13-g2-summary.json
```

- [Generated report](T13-g2-level-report.md)
- [Machine summary](data/T13-g2-summary.json)
- [All neutral records](data/T13-g2-records.json)
- Rote: [raw rows](data/T13-g2-rote-raw.json), [neutral rows](data/T13-g2-rote-records.json), [manifests](data/T13-g2-rote-manifests.json), [trajectories/provider receipts](data/T13-g2-rote-trajectories.jsonl)
- Browser Use: [raw rows](data/T13-g2-browser-use-raw.json), [neutral rows](data/T13-g2-browser-use-records.json), [diagnostic dumps/provider receipts](data/T13-g2-browser-use-dumps.json)
- [Original launch-gate output](data/T13-g2-gate.md)

## Limits

This certifies tier-0 level economics on three deterministic local fixtures, not learned
memory, production-site robustness, vision-heavy tasks, other providers/models, or drift.
B5 remains the next trust instrument. G1 remains the real-WordPress length result; G2 does
not replace it with a claim that local fixture percentages generalize to the web.
