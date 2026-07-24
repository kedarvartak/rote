# G2 tokens-per-task level

Protocol `p1-g2-fixtures-v1-b1-b3`; openai/`gpt-4.1-mini`; Browser Use 0.13.6; 15+ successful runs required per harness/task; matched-repetition 10,000-resample 95% intervals.

**Formal G2 result: PASS.** The gate requires a positive lower token-reduction bound, success parity, measured cache buckets, the same model, and at least 15 successes per side.

| Task | Logical token reduction (95% CI) | Cost reduction (95% CI) | Latency reduction (95% CI) | Success R/B | ≥80% target |
|---|---:|---:|---:|---:|---|
| B1 | 91.8% [91.8%–91.9%] | 82.3% [82.1%–82.5%] | 47.6% [44.3%–50.7%] | 18/18 / 18/18 | yes |
| B2 | 77.3% [76.9%–78.1%] | 56.2% [54.7%–58.1%] | 13.9% [3.1%–22.3%] | 18/18 / 18/18 | NO |
| B3 | 93.3% [92.4%–93.9%] | 85.4% [83.6%–86.6%] | 55.5% [51.3%–58.8%] | 18/18 / 18/18 | yes |

## Absolute levels

| Task | Harness | Mean logical tokens | Mean ms | p50 ms | p95 ms | Mean $/task |
|---|---|---:|---:|---:|---:|---:|
| B1 | Rote | 2835.6 | 9737.3 | 9635.5 | 11051.3 | $0.0014 |
| B1 | Browser Use | 34654.7 | 18584.2 | 18208.0 | 21668.9 | $0.0076 |
| B2 | Rote | 8248.2 | 20295.3 | 19048.0 | 25413.3 | $0.0038 |
| B2 | Browser Use | 36338.8 | 23579.5 | 22421.5 | 28376.6 | $0.0086 |
| B3 | Rote | 2319.0 | 7783.9 | 7297.0 | 10391.8 | $0.0011 |
| B3 | Browser Use | 34652.5 | 17474.6 | 17382.5 | 19468.9 | $0.0075 |

B1 and B3 clear the benchmark catalog’s 80% target. B2 passes the formal positive-margin G2 gate but does **not** clear 80%; it is above the 50% kill threshold. Do not describe all three tasks as ≥80% wins. Latency is reported but not gated in V1: no task clears the catalog’s 5× pass target; B1 and B2 are below its 2× kill line, while B3 is between them.

## Rote mean logical tokens by source

| Task | Source | Mean tokens/run |
|---|---|---:|
| B1 | planner | 2835.6 |
| B2 | planner | 8248.2 |
| B3 | planner | 2319.0 |

Verification audit: 54 Rote manifests and 54 Browser Use dumps; all successes independently verified; 163 raw Browser Use provider receipts retained.

Prices: `2026-07-15` (https://platform.claude.com/docs/en/about-claude/models/overview + https://developers.openai.com/api/docs/pricing). Logical tokens include uncached/cache-read/cache-write input plus output; dollars price each bucket separately.

