# T43 — P2 provider-billed exit-campaign preflight

**Milestone:** P2 / #185
**Status:** deterministic preflight complete; provider-billed collection not run

## Purpose

Freeze the four remaining P2 measurement rows before collecting paid data: T0
record→distill→replay economics, T2 novel-on-known-site advisory-memory utility,
real-page routing/predictor calibration, and B4 long-run compaction economics.

## What the preflight proves

`P2CampaignProtocolSchema` fixes the provider/model, 15-repetition minimum, all four
required gates, their stop/retreat thresholds, output locations, required tagged usage,
reset command, and task-bound independent oracle. `rote-bench p2-campaign-preflight`
parses a no-provider dry run and writes a report only when every planned row has all four
normalized token buckets, every declared source tag, pricing acknowledgement, reset
evidence, and matching authoritative oracle evidence.

A missing/duplicate row, missing bucket/tag, unavailable pricing, reset mismatch, or
oracle mismatch throws `P2CampaignPreflightError`; no result is rounded into a pass. UI
or harness-only oracles cannot parse as campaign evidence. The command reports
`provider_calls: 0`, so it cannot be cited as a campaign result.

## Run

```bash
npm exec --workspace @rote/bench -- rote-bench p2-campaign-preflight \
  scripts/bench/p2-campaign/protocol.json \
  --dry-run scripts/bench/p2-campaign/dry-run.json \
  --out /tmp/p2-campaign-preflight.json
```

## Remaining evidence

The actual campaign must implement the pinned reset/oracle commands, collect at least 15
fresh repetitions per compared cell, retain raw provider receipts and non-success
outcomes, and publish seeded-bootstrap success-parity results. T0 requires >=80%
reduction; T2 requires >=30% at parity and retreats below 15%; routing requires >=50% of
warm steps off the frontier at parity; B4 makes no cost claim without 50+ step provider
usage. See [03](../03-benchmark.md) and [05](../05-roadmap.md).
