# T4 — OpenAI append-only history cache layout

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Protocol | `p1-g1-wordpress-v3-grounded`, WP-N15 |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Change under test | Place append-only action history before current page, controls, and observation |
| Raw runs | [`run A`](data/T4-openai-cache-layout-run-a.jsonl) · [`run B`](data/T4-openai-cache-layout-run-b.jsonl) |

## Question

E3.1 found that only 2/26 eligible T3 calls hit OpenAI's automatic cache. The volatile
suffix previously began with the current page, so URL/title churn occurred before the
action history and broke the exact prefix on every step. Can ordering the growing,
append-only history first produce provider-reported cache reads without padding the prompt
or changing logical-input accounting?

## Result

Both independent WP-N15 runs completed successfully with exact-title database verification.
Both reported a **1,024-token cache read on an incremental planning step** after enough
action history accumulated:

| Run | Provider calls | Incremental history hit | Other hit | Outcome |
|---|---:|---:|---:|---|
| A | 16 | step 10: 1,024 tokens | step 4: 19,712 tokens | success |
| B | 16 | step 11: 1,024 tokens | none | success |

The 1,024-token incremental hit repeated in 2/2 runs. Run A's large step-4 hit is retained
but not attributed to the new growing-history layout; it may reuse an earlier heavyweight
page prefix still inside OpenAI's cache lifetime.

No padding or fabricated reduction was added. Every row still reports logical input as
`input_tokens + cache_read_tokens + cache_write_tokens`; caching changes the billing
bucket, not the amount of prompt material processed.

## Decision

E3.2's minimum qualification gate passes: a real warm incremental step reports
`cache_read_tokens > 0` repeatably. This is **not yet a strong economic result**—only one
incremental call per run hit. E3.4 must protect prefix immutability, and E3.5 must report
hit rate and dollar impact before B3 can support a launch claim.
