# Post-action evidence qualification

This isolated P1 qualification checks the #54 strong-effect implementation on fresh canonical B1–B3 runs. It is a single-harness exactness and receipt audit, not a competitor certification or token/cost/latency comparison.

## Protocol

`protocol.json` pins Rote `0960f9915c71de703aedf29b623be717b169817e`, OpenAI `gpt-4.1-mini`, 1920×1080, three repetitions per task, and shadow-only click evidence. Collection refuses runtime changes under `packages/action/src` or `packages/agent/src` relative to that commit.

## Collect

```bash
export OPENAI_API_KEY=...
scripts/bench/post-action-evidence/run-qualification.sh
```

The command reuses the append-safe canonical Rote runner, assembles manifests and trajectories, reconciles every raw receipt, and writes the deterministic report and summary under `bench-out/post-action-evidence-qualification/evidence/`.

## Reproduce

Published T26 evidence needs no provider key:

```bash
npm run reproduce:post-action-evidence
```

Strong fill/select/navigation effects must pass and remain redacted. Click reaction must remain non-enforcing; generic DOM or URL churn is not semantic verification.
