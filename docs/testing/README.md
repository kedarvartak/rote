# Testing log

Numbered records of tests run against **real** Rote — live browser, live model,
live API key. One document per test, written for a reader who arrives cold in six
months and needs to know what we did, what happened, and what we concluded.

These are not unit tests. The deterministic fake-world suite lives with the code
(`packages/*/test/`) and runs in CI on every PR. This folder is for the tests CI
*cannot* run: the ones that cost money, launch a browser, and tell us whether the
software actually works.

## Why this folder exists

`docs/03` requires that we publish method and raw data, not just numbers —
"credibility in this space comes from reproducibility". A test whose method is
undocumented is a claim, not evidence. Each record states its method precisely
enough to be re-run and disagreed with.

## Conventions

- **`T<N>-<slug>.md`**, numbered in the order the tests were run. Never renumber:
  issues and commits cite these ids.
- Every record carries: date, what was tested, **exactly how** (commands, models,
  fixture versions), what happened, what we concluded, and what must change.
- **Record what actually happened, including our own mistakes.** A test log that
  only contains successes is marketing. Failures, wrong turns, and corrections are
  the parts with information in them.
- Numbers carry units. Token counts say input/output. Prices name the model.
- Findings that need work become GitHub issues; the record links them, and the
  issue links back.

## Records

| Test | Date | Subject | Outcome |
|---|---|---|---|
| [T1](T1-openai-dry-run.md) | 2026-07-15 | First live run of the B1–B3 fixtures on a real OpenAI key | B1/B3 pass; **B2 fails 0/7** on a design flaw → #49 #50 #51 #52 |
| [T2](T2-measurement-page-selection.md) | 2026-07-17 | Select and validate P1's real measurement page | Digest-pinned WordPress selected; exactly 120 benchmark posts, 22,279 approximate tokens with zero range across 15 fresh measured sessions after one declared warm-up |
| [T3](T3-rote-openai-exploratory.md) | 2026-07-22 | One Rote run at each real-page curve checkpoint | 7/10-step cells pass; 15/20/25 fail; A4 diffs are 24–89 characters; explicitly not comparison evidence |
| [T4](T4-openai-cache-layout.md) | 2026-07-22 | Qualify append-only history ordering against OpenAI automatic caching | WP-N15 passes 2/2; both runs report a 1,024-token incremental cache read; economics remain unmeasured |
| [T5](T5-browser-use-completion.md) | 2026-07-22 | Prevent post-Apply disappearance from causing a false Browser Use conclusion | Fresh v4 WP-N07 pair passes in 7 calls/harness; instrument smoke only |
| [T6](T6-wordpress-corpus-cleanup.md) | 2026-07-22 | Remove WordPress's unrelated stock post and gate the exact 120-title corpus | Stability remains zero-range; fresh v5 WP-N10 pair passes; instrument smoke only |
| [T7](T7-browser-use-long-cell-qualification.md) | 2026-07-22 | Bound Browser Use exact-set long-cell reliability before certification | N15 can pass with accessible labels; N20 fails safely; bulk-checkbox long cells are a no-go |
| [T8](T8-title-review-curve-smokes.md) | 2026-07-22 | Qualify non-checkbox title-review replacements across the full curve | All five paired cells pass exact all-120-post verification; certification collection ready |
