# T16 — Launch demo: cold, replay, drift fallback

## Result

The runnable launch demo completed three phases against the B1 fixture with the packaged
CLI shape and OpenAI `gpt-4.1-mini`:

| Phase | Outcome | Steps | Logical input | Output | Classification |
|---|---|---:|---:|---:|---|
| Cold exploration | verified success | 5 | 2,661 | 182 | cold |
| Exact candidate | verified success | 5 | **0** | **0** | warm replay |
| Deterministic selector drift | verified success | 5 cold steps | 2,720 | 190 | `replay_failed` → cold fallback |

The drift changes the login form, field, submit, and download IDs while preserving the
business task. The stale playbook fails its first post-navigation assertion on
`#login-form`; that failed replay remains a separate failure manifest. The classified
plain agent then re-navigates, grounds the changed controls, completes, and independently
verifies the exact report text.

This is **not learned replay or scoped drift repair**. The candidate is explicitly created
from the checked-in hand-written playbook. The drift path demonstrates detection and safe
full-agent fallback, which is what the current build ships.

## Run it

```bash
npm ci
export OPENAI_API_KEY=...
scripts/demo/run-launch-demo.sh
```

Requirements: Node 20+, Chrome/Chromium, and an available local port 8094 (override with
`ROTE_DEMO_PORT`). Artifacts are written under an ignored `bench-out/launch-demo-*`
directory unless `ROTE_DEMO_OUT` is set.

## Watch or audit

- [Asciinema v2 terminal recording](../demo/launch-demo.cast)
- [Captured terminal output](data/T16-launch-demo-output.txt)
- [Four manifests: cold success, warm success, failed stale replay, fallback success](data/T16-launch-demo-manifests.json)
- [Cold/fallback provider receipts](data/T16-launch-demo-provider-receipts.json)

The committed manifests redact the canonical fixture password from `task_spec`; provider
usage and outcomes are unchanged. Full plaintext trajectories remain local because tool
arguments contain the fixture credential and Rote's own [limitations contract](../known-limitations.md)
warns that trajectories are not a secret-safe publication format.

The recording is generated from the captured stdout of the evidence run; the shell script
is the executable source of truth.

## Limit

Re-navigation cannot undo arbitrary server-side effects. This demo deliberately makes the
stale assertion fail immediately after navigation and before mutation. Workflows that can
fail only after destructive effects need explicit reset/compensation semantics; Rote does
not provide generic transactions.
