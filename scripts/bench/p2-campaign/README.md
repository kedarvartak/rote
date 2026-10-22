# P2 provider-billed exit campaign

This directory freezes the collection contract before any provider-billed P2 claim. It
covers T0 automated-distillation reduction, T2 advisory site-memory utility, real-page
routing/predictor telemetry, and B4 50+ transition economics. It is a preflight only: it
makes **zero provider calls** and cannot establish a performance result.

## No-provider preflight

```bash
npm exec --workspace @rote/bench -- rote-bench p2-campaign-preflight \
  scripts/bench/p2-campaign/protocol.json \
  --dry-run scripts/bench/p2-campaign/dry-run.json \
  --out /tmp/p2-campaign-preflight.json
```

The command rejects a missing row, normalized usage bucket, declared source tag, pricing
acknowledgement, reset command/digest, or task-bound independent oracle. `protocol.json`
is strict and intentionally has no credentials, raw inputs, or dispatched values.

## Before collection

Do not collect until the preflight passes and each placeholder reset/oracle command is
implemented against the pinned target. Provider collection must retain all raw JSONL,
Rote manifests, provider receipts, dated pricing, and non-success outcomes. See
`docs/03-benchmark.md` and issue #185 for the fixed gates and retreat rules.

## After collection

Turn the recorded runs into one `P2CampaignRunRecord` per billed run and evaluate them
against this same protocol:

```ts
import { evaluateP2CampaignGates, renderP2CampaignGateResult } from '@rote/bench';

const result = evaluateP2CampaignGates(protocol, records);
process.stdout.write(renderP2CampaignGateResult(result));
```

The verdict reads its floors from `protocol.json`, pairs only repetitions in which both
sides succeeded, and reports `not_certifiable` — never `pass`, and never `fail` — when
the evidence is too thin, mixed across pricing tables, or missing the routing step split.
B4 is `reported_only`: docs/05 requires the long-run economics to be measured but freezes
no floor for them.
