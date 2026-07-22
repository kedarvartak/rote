# T3 — Exploratory Rote curve on WordPress

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Protocol | `p1-g1-wordpress-v2-openai` |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Scope | **Exploratory: one run per checkpoint, not comparison evidence** |
| Raw artifact | [`data/T3-rote-openai-exploratory.jsonl`](data/T3-rote-openai-exploratory.jsonl) |

## Why this is exploratory

The publishable protocol requires at least 15 repetitions per harness and success parity.
An attempted certification batch was too slow for an interactive session, so this record
keeps one independently verified Rote run at each task length. It is useful for finding
shape and reliability problems; it cannot support a Rote-vs-Browser Use claim or a
confidence interval.

## Endpoint results

Logical input is `input_tokens + cache_read_tokens + cache_write_tokens`; this keeps cache
hits from appearing as token reduction.

| Checkpoint | Provider calls | Outcome | Logical input tokens | Output tokens |
|---|---:|---|---:|---:|
| WP-N07 | 7 | success | 42,531 | 255 |
| WP-N10 | 10 | success | 44,847 | 334 |
| WP-N15 | 18 | failure — unresolved target | 73,240 | 714 |
| WP-N20 | 18 | failure — exact-title database verification | 50,904 | 547 |
| WP-N25 | 33 | failure — unresolved target | 129,941 | 978 |

The longer tasks are not at success parity. Their token endpoints describe spend incurred,
not successful-task economics. Reliability—not accounting—is the immediate blocker to a
publishable long-task curve.

## Working-memory observations

A4 fired on the real page in every cell. The heavyweight posts page rendered at roughly
47,400 characters; ordinary checkbox/select diffs were typically 88 characters (24–89
observed), about 99.8% smaller for those incremental transitions. Large replacement states
still correctly used a grounded bootstrap rather than forcing a diff under the 4,000-character
ordinary budget.

| Mode | Observed rendered size |
|---|---:|
| Login-page full | 507 characters |
| Posts-page bootstrap | 47,269–47,415 characters |
| Ordinary diff | 24–89 characters; median 88 |

OpenAI reported cache reads on 2 of 86 calls (39,552 tokens total), once in WP-N15 and once
in WP-N25. Of 86 calls, 26 cleared OpenAI's 1,024-token eligibility floor; only 2/26
eligible calls hit (7.7%, or 2.3% of all calls). The reproducible preflight report is
[`data/T3-openai-cache-preflight.json`](data/T3-openai-cache-preflight.json). This proves
the accounting and provider can observe automatic hits, but it is not a qualified cache
layout. E3 must make the immutable prefix deliberate and measure repeatable hits.

## Decision

- Keep E1.4 open: the full ≥15-run Rote matrix is not complete.
- Do not draw or publish the comparison curve from this artifact.
- Use the failures to harden long-task target grounding before spending on certification.
- Continue future collection in resumable, one-run batches; never overwrite completed rows.
