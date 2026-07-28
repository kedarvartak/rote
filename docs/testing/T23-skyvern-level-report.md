# Skyvern 1.0.47 B2/B5 generated-code feasibility

**Decision: STOP before certification.** The pinned adapter does not support a publishable comparative token or cost cell.

| Audit | Result |
|---|---:|
| Cold exact success | 4/4 (95% Wilson 51.0–100.0%) |
| Harness-declared cold success | 4/4 |
| Complete generated-code warm/drift pairs | 3/3 required |
| Warm/drift exact success | 23/24 |
| Warm/drift runs using a generated script | 24/24 |
| Runtime AI fallback triggered | 24/24 |
| Zero-LLM replay observed | 0/24 |
| Generated artifact changed after run | 0/24 |
| Harness-success / oracle-failure | 0 |
| Destructive decoy dispatches | 0 |
| Ambiguous fixture exact success | 4/4 |
| Complete raw provider receipts | 0/28 |

## Disqualifications

- raw provider receipts are incomplete for 28/28 attempts; token and cost ranking prohibited
- aggregate runtime telemetry cannot attribute generated replay, repair, and AI-fallback usage separately

Skyvern's own per-call aggregate log telemetry is retained diagnostically, but it is not a raw provider response. Therefore these feasibility findings do not support Skyvern-vs-Rote token, cost, latency, or universal reliability claims. Rote's compared replay playbook remains hand-authored, while Skyvern generated its artifacts.
