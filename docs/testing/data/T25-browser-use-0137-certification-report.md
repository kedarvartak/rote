# G2 tokens-per-task level

Protocol `p1-g2-fixtures-v3-b2-browser-use-0137-paired`; openai/`gpt-4.1-mini`; Browser Use 0.13.7; 15+ successful runs required per harness/task; matched-repetition 10,000-resample 95% intervals.

**Formal G2 result: PASS.** The gate requires a positive lower token-reduction bound, success parity, measured cache buckets, the same model, and at least 15 successes per side.

| Task | Logical token reduction (95% CI) | Cost reduction (95% CI) | Latency reduction (95% CI) | Success R/B | ≥80% target |
|---|---:|---:|---:|---:|---|
| B2 | 83.1% [82.1%–83.9%] | 68.2% [66.3%–69.9%] | 43.6% [39.0%–48.1%] | 18/18 / 18/18 | yes |

## Absolute levels

| Task | Harness | Mean logical tokens | Mean ms | p50 ms | p95 ms | Mean $/task |
|---|---|---:|---:|---:|---:|---:|
| B2 | Rote | 8352.7 | 19776.4 | 18695.5 | 23813.7 | $0.0038 |
| B2 | Browser Use | 49324.1 | 35084.7 | 33672.5 | 46432.4 | $0.0120 |

Fresh paired Browser Use 0.13.7 B2 clears the catalog’s 80% token target. Both harnesses ran as cold agents; this cell does not test replay or learning. Latency is reported, not gated in V1.

## Rote mean logical tokens by source

| Task | Source | Mean tokens/run |
|---|---|---:|
| B2 | planner | 8352.7 |

Verification audit: 18 Rote manifests and 18 Browser Use dumps; all successes independently verified; 74 raw Browser Use provider receipts retained.

Prices: `2026-07-15` (https://platform.claude.com/docs/en/about-claude/models/overview + https://developers.openai.com/api/docs/pricing). Logical tokens include uncached/cache-read/cache-write input plus output; dollars price each bucket separately.

