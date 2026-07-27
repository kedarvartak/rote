# G2 tokens-per-task level

Protocol `p1-g2-fixtures-v2-b2-exact`; openai/`gpt-4.1-mini`; Browser Use 0.13.6; 15+ successful runs required per harness/task; matched-repetition 10,000-resample 95% intervals.

**Formal G2 result: PASS.** The gate requires a positive lower token-reduction bound, success parity, measured cache buckets, the same model, and at least 15 successes per side.

| Task | Logical token reduction (95% CI) | Cost reduction (95% CI) | Latency reduction (95% CI) | Success R/B | ≥80% target |
|---|---:|---:|---:|---:|---|
| B2 | 83.6% [82.7%–84.6%] | 69.3% [67.7%–71.1%] | 47.8% [43.6%–51.9%] | 18/18 / 18/18 | yes |

## Absolute levels

| Task | Harness | Mean logical tokens | Mean ms | p50 ms | p95 ms | Mean $/task |
|---|---|---:|---:|---:|---:|---:|
| B2 | Rote | 8354.1 | 19934.5 | 19924.0 | 22196.9 | $0.0038 |
| B2 | Browser Use | 50875.0 | 38184.7 | 37482.0 | 50782.1 | $0.0124 |

Corrective B2 clears the catalog’s 80% token target. Latency is reported, not gated in V1.

## Rote mean logical tokens by source

| Task | Source | Mean tokens/run |
|---|---|---:|
| B2 | planner | 8354.1 |

Verification audit: 18 Rote manifests and 18 Browser Use dumps; all successes independently verified; 76 raw Browser Use provider receipts retained.

Prices: `2026-07-15` (https://platform.claude.com/docs/en/about-claude/models/overview + https://developers.openai.com/api/docs/pricing). Logical tokens include uncached/cache-read/cache-write input plus output; dollars price each bucket separately.

## Decision

Corrective B2 certification passes and supersedes only T13's withdrawn B2 row. Combined
with unchanged B1/B3 exact terminal-state evidence, the full G2 level gate is restored.
B2 now also clears the catalog's 80% token target. This does not alter frozen T13 data or
retroactively strengthen its old oracle.

## Reproduce without a provider

```bash
node packages/bench/bin/rote-bench.js g2-report \
  docs/testing/data/T20-b2-exact-records.json \
  --rote-manifests docs/testing/data/T20-b2-exact-rote-manifests.json \
  --browser-dumps docs/testing/data/T20-b2-exact-browser-use-dumps.json \
  --protocol-id p1-g2-fixtures-v2-b2-exact --min-runs 15 \
  --out /tmp/t20.md --summary /tmp/t20.json
cmp /tmp/t20.json docs/testing/data/T20-b2-exact-summary.json
```

## Evidence

- [Machine summary](data/T20-b2-exact-summary.json)
- [All neutral records](data/T20-b2-exact-records.json)
- Rote: [raw rows](data/T20-b2-exact-rote-raw.json), [neutral rows](data/T20-b2-exact-rote-records.json), [manifests](data/T20-b2-exact-rote-manifests.json), [trajectories and provider receipts](data/T20-b2-exact-rote-trajectories.jsonl)
- Browser Use: [raw rows](data/T20-b2-exact-browser-use-raw.json), [neutral rows](data/T20-b2-exact-browser-use-records.json), [diagnostic dumps, exact oracle, and provider receipts](data/T20-b2-exact-browser-use-dumps.json)

