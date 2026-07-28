# T23 — Skyvern 1.0.47 generated-code qualification

**Date:** 2026-07-28

**Protocol:** `skyvern-v1.0.47-b2-b5-qualification-v1`

**Decision:** **STOP before certification.** Do not publish a Skyvern-vs-Rote token, cost, latency, or universal reliability ranking from this evidence.

## Question

Can an unmodified, pinned Skyvern release prepare exact B2 generated-code artifacts, reuse each artifact on unchanged and frozen B5 pages, expose preparation/fallback/regeneration accounting, and clear the three-pair gate before ≥15-run certification spend?

This is a feasibility test of Skyvern's documented reuse path. It is not a claim that Rote learns: Rote's B2 playbook remains hand-authored.

## Frozen configuration

| Item | Value |
|---|---|
| Skyvern release | `v1.0.47` |
| Source commit | `9fc0b2aee079ee34ae3cdb578ca346f06c733218f` |
| Image index digest | `sha256:ad58d950f1c8cc3bc2d442228f701243b80b84494f11bbb066347ed034006e77` |
| License | AGPL-3.0 |
| Provider/model | OpenAI `gpt-4.1-mini` |
| Browser viewport | 1920×1080 (also observed in retained Skyvern screenshots) |
| Workflow | `run_with: code`, AI fallback on, self-healing on, adaptive caching off, terminal script generation on |
| Fixture/oracle | corrected exact B2 eight-field task and terminal submission audit; frozen B5 mutations |
| Cold cap / pair gate | at most 6 cold attempts; 3 exact complete warm/drift pairs required |

The Docker image and source were not patched. The adapter, fixture server, and external oracle are Rote-authored benchmark edges and do not ship in `@rote/cli`.

## Collection and independent grading

Each repetition created a fresh Skyvern workflow. A cold agent run had to complete and submit all eight exact values before its generated artifact was eligible. The paired phase then used that workflow's generated script on:

1. unchanged canonical B2;
2. field IDs renamed;
3. submit ID renamed;
4. wrappers plus all IDs renamed;
5. destructive stale-selector decoys; and
6. visually ambiguous company controls.

The fixture server independently recorded submitted values and any dispatch to an element marked `data-destructive="true"`. The audit listener was registered after the frozen form's synchronous submit handler; an exact non-empty submission therefore means that handler had already written the exact terminal summary and revealed the completion DOM before the audit beacon fired. This is an instrumented live terminal-state oracle independent of Skyvern's conclusion, not a later inference from its self-report. Harness completion without that exact eight-value audit would be a silent failure and stop collection. Every failed or abandoned attempt remained in the denominator.

One wrappers attempt in repetition 1 was in flight when the collector process was interrupted. It was canceled, retained as a failed/abandoned attempt, and never rerun under the same identity. A fourth fresh preparation was therefore collected so three *exact* complete pairs—not merely three observed pairs—cleared the qualification gate.

## Result

| Audit | Result |
|---|---:|
| Cold exact success | **4/4** (95% Wilson **51.0–100.0%**) |
| Harness-declared cold success | **4/4** |
| Exact complete generated-code pairs | **3/3 required** |
| Warm/drift exact success | **23/24** |
| Completed warm/drift exact success | **23/23** |
| Warm/drift attempts using a generated script | **24/24** |
| Runtime AI fallback triggered | **24/24** |
| Zero-LLM replay observed | **0/24** |
| Generated artifact changed after paired run | **0/24** |
| Harness-success / oracle-failure | **0** |
| Destructive-decoy dispatches | **0** |
| Ambiguous fixture exact success | **4/4** |
| Complete raw provider receipt sets | **0/28** |

All 27 completed attempts passed the independent exact oracle. The abandoned run is the sole non-exact attempt. The ambiguous page remained safe because each generated artifact selected the unique named company field; visual duplication did not make that selector ambiguous. This is successful robust targeting, not evidence of a fail-closed branch.

## Generated artifact lineage

Each exact cold preparation produced a distinct version-1 artifact. The identity and code hash remained unchanged before and after all paired mutations for that repetition.

| Repetition | Script | Version | SHA-256 |
|---:|---|---:|---|
| 1 | `s_556468495807134242` | 1 | `f9b5e29a8705aaefb6c6bf526fa0e835f680ba5154b6653e1000dc2a3a9cfa19` |
| 2 | `s_556474770754353700` | 1 | `0de435d3dd1375e850da39bebb78b2f803da632fd90cd3ca5a25ac753969e182` |
| 3 | `s_556481320579480110` | 1 | `a662dbba5b3ce70dd75acdec982066c4026f2fab483163f078b439c646f02c7c` |
| 4 | `s_556488677858458152` | 1 | `37cd346ed257a6be26a490920bfae7eadb5d9a1832686d320eeb4007969ce499` |

The generated code is retained in `data/T23-skyvern-generated-artifacts.json`; each receipt also records artifact identity before and after its mutation and the script revision actually used.

## Why certification stopped

Skyvern's self-hosted logs exposed per-call model name, prompt class, input tokens, cached tokens, output tokens, and estimated cost. T23 retains those as **aggregate diagnostic telemetry** and separates runtime calls from asynchronous `script-reviewer` generation/regeneration calls. The logs were not raw OpenAI response receipts, so completeness could not be independently reconciled against provider responses.

Missing raw receipts are not zero. Under the frozen fairness contract, **0/28 complete raw receipt sets prohibits token and dollar ranking**, regardless of exact task success. The aggregate stream also cannot reconcile generated replay, repair, and AI-fallback usage into separate provider-backed buckets. Both limitations are explicit disqualifications; no ≥15-run certification matrix was opened.

The runtime result is also narrower than the ideal documented code path: all 24 paired attempts loaded a generated script, but all 24 triggered AI fallback and none was zero-LLM. This does **not** show that Skyvern generally requires fallback; it describes four artifacts on one deterministic local task. Because raw receipts are incomplete, aggregate token totals are intentionally not promoted into a comparative claim.

## Reproduce

Rebuild the report, decision, and neutral rows byte-for-byte:

```bash
npm run reproduce:skyvern
```

Live recollection requires Docker and an authorized OpenAI key; see [`scripts/bench/skyvern/README.md`](../../scripts/bench/skyvern/README.md). Collection receipts are append-only. `finalize-qualification.py` derives the report input after Skyvern's asynchronous telemetry settles without rewriting the raw collection.

## Frozen artifacts

- [`T23-skyvern-raw-collection.jsonl`](data/T23-skyvern-raw-collection.jsonl) — append-only collector output, including the abandoned run.
- [`T23-skyvern-qualification-receipts.jsonl`](data/T23-skyvern-qualification-receipts.jsonl) — report input with settled aggregate telemetry split into runtime and regeneration buckets.
- [`T23-skyvern-generated-artifacts.json`](data/T23-skyvern-generated-artifacts.json) — generated code, IDs, versions, and hashes.
- [`T23-skyvern-qualification-summary.json`](data/T23-skyvern-qualification-summary.json) — machine stop decision.
- [`T23-skyvern-neutral-records.json`](data/T23-skyvern-neutral-records.json) — independently graded neutral rows; not eligible for efficiency ranking.
- [`T23-skyvern-level-report.md`](T23-skyvern-level-report.md) — deterministic generated report.

## Claim boundary

T23 supports only this statement:

> On the frozen exact B2/B5 qualification, pinned Skyvern 1.0.47 produced four exact cold preparations and three exact complete generated-code pairs. All 23 completed paired runs passed the independent oracle, but all 24 paired attempts triggered AI fallback, no zero-LLM replay was observed, and complete raw provider receipts were unavailable. Certification and comparative token/cost claims were stopped.

It does not establish Rote superiority, general Skyvern reliability or cost, arbitrary workflow repair, production-site behavior, or parity between Skyvern's generated artifacts and Rote's hand-authored playbook.
