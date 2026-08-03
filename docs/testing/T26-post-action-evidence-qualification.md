# T26 — Post-action evidence qualification

**Date:** 2026-08-03  
**Milestone:** P1 / E2.4  
**Protocol:** `p1-post-action-evidence-b1-b3-qualification-v1`

## Question

After #123 added zero-LLM observed effects, do the canonical B1–B3 live tasks still pass exact independent verification without post-action repair calls, and is generic click reaction strong enough to enforce?

## Frozen method

The protocol was committed before collection. It pins Rote `0960f9915c71de703aedf29b623be717b169817e`, OpenAI `gpt-4.1-mini`, 1920×1080, the canonical B1–B3 prompts/fixtures/oracles, and three fresh attempts per task. This is a bounded single-harness qualification, not a certification matrix or competitor comparison.

Each action used the shipped settled-page loop:

- `fill` and `select` required the resolved live control to retain the exact dispatched value;
- navigation would require the exact canonical target URL (the canonical scripts needed no planner navigation);
- click URL/DOM changes were recorded as non-enforcing reaction evidence;
- planner-declared completion still required the canonical independent terminal-state verifier.

Collection:

```bash
export OPENAI_API_KEY=...
scripts/bench/post-action-evidence/run-qualification.sh
```

The collector is append-safe through the existing single-run G2 writer and refuses an action/agent implementation that differs from the protocol-pinned commit.

## Result

All **9/9** attempts passed exact independent verification:

| Task | Exact success | Mean logical tokens/run |
|---|---:|---:|
| B1 | 3/3 | 2,961.0 |
| B2 | 3/3 | 8,374.3 |
| B3 | 3/3 | 2,179.3 |

The logical levels are diagnostics only. This protocol has no contemporaneous pre-change or competitor control, so it publishes no token, cost, or latency reduction.

Across 57 agent actions/calls:

- **33/33** strong fill/select effects were observed and enforced;
- **15/15** canonical fixture clicks produced a URL or distilled-DOM reaction, retained as shadow evidence;
- **9/9** `done` actions carried no derived evidence and reached the independent verifier;
- **57/57** raw OpenAI receipts reconciled one-to-one with planner-tagged calls;
- **0** repair calls occurred.

The evidence mechanism therefore introduced no additional LLM call or source tag in these runs. It also does not add dispatched values to the planner observation or duplicate them in evidence/error messages.

## Click decision

Generic click reaction remains **shadow-only** for P1. Deterministic tests establish all of the relevant boundaries:

| Scenario | Observed classification | Why it cannot gate success |
|---|---|---|
| True no-op | `click_no_observable_reaction` | Correctly detected, but observationally identical to a legitimate external effect with no DOM signal |
| Visible DOM effect | `click_reaction_observed` | Reaction is useful diagnostic evidence, not proof of the requested semantics |
| URL transition | `click_reaction_observed` | Reaction is observable, while final task correctness remains separate |
| Unrelated visible mutation after no-op | `click_reaction_observed` | Demonstrates false attribution if “any diff” were enforced as success |
| Download/external side effect without DOM signal | indistinguishable from no-op | Enforcing no-diff failure would make Rote worse than the plain baseline |

Because the same bit can false-accept unrelated churn and false-reject a legitimate external effect, no additional sample can turn generic “any diff” into a semantic verifier. A future click check must use action-specific authoritative evidence (for example a download event or caller-authored oracle), not a looser threshold over this signal.

## Conclusion

The strong-effect implementation is qualified on the canonical local tasks: exact success remained 9/9, every receipt reconciled, and no post-action repair or extra LLM call was observed. The no-op click case is detected, but intentionally does not fail execution by itself. Independent final verification remains the only task-success authority.

This closes #54’s P1 decision and implementation scope without claiming that clicks are generically verified. Provider/site/model generality and action-specific browser-event evidence remain unbuilt.

## Frozen evidence

- [Protocol](data/T26-post-action-evidence-protocol.json)
- [Canonical task configuration](data/T26-post-action-evidence-tasks.json)
- [Raw run rows](data/T26-post-action-evidence-raw-runs.json)
- [Run manifests](data/T26-post-action-evidence-manifests.json)
- [Trajectories and provider receipts](data/T26-post-action-evidence-trajectories.jsonl)
- [Deterministic summary](data/T26-post-action-evidence-summary.json)
- [Generated report](data/T26-post-action-evidence-report.md)

Reproduce the report and fail-closed receipt/evidence audit without a provider key:

```bash
npm run reproduce:post-action-evidence
```
