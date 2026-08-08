# T28 — Registry-backed provider quickstart

## Result

**Pass.** On 2026-08-08, an initially empty directory with no checkout or package manifest
ran the public `@rotehq/cli@0.1.0` through version-pinned registry `npx`. The cold OpenAI
planner concluded in one step, and the CLI's separately captured live-page verifier found
the required visible text before the manifest reported success.

```text
success: task verification passed
run: 1f321e8a-a21b-42b7-9bbc-dfe80d5d2ed6
phase: cold
steps: 1
tokens: 366 input + 26 output
```

This closes the provider-backed packaging check in #107. It is a release smoke, not a new
efficiency, site-generality, provider-generality, replay, repair, or learned-memory claim.

## Method

Environment: Node `v22.22.0`, npm `10.9.4`, Chromium `150.0.7871.128 snap`, one
`OPENAI_API_KEY`, and no source checkout. The key value was neither printed nor retained.
The working directory had zero entries immediately before invocation; stdout and stderr
were captured outside it.

```bash
export ROTE_LLM_PROVIDER=openai
export ROTE_BASE_DIR="$PWD/.rote"
npx --yes @rotehq/cli@0.1.0 run \
  "Confirm that the page says Rote quickstart ready." \
  --url 'data:text/html,<h1>Rote quickstart ready</h1>' \
  --verify-text 'Rote quickstart ready' \
  --model gpt-4.1-mini --max-steps 3
```

The data URL is static and contains only the required terminal text. Harness conclusion
alone was insufficient: after `browser.done`, the CLI captured the page independently and
required `Rote quickstart ready` in its visible title/element text. Failure would have
written a failure manifest and returned a non-zero command exit.

## Package audit

The registry returned `latest: 0.1.0`. A fresh `npm pack @rotehq/cli@0.1.0` download had:

| Field | Observed |
|---|---|
| Package | `@rotehq/cli@0.1.0` |
| Packed bytes | 106,253 bytes |
| Entries | 7 |
| SHA-256 | `8fe18b3e2435cfb7538bbb0b003d616fcbfbbf05d4fef84b264b00a061a3b262` |
| npm shasum | `b0a18f34ef0c119128ce567d810712aadfe58d36` |
| npm integrity | `sha512-SDQGpvJaI8g/kxJLMbccJDRl7uyMjLeXQ0XxeEjAdG66a6rfEO+NXIo1nRCQsy2CEviEFp45umiMzmHNm7sOdA==` |
| Audited source commit | `5564443558c9eb9e48d29ff1aca80d205cf0d32b` |

These values exactly match the maintainer-audited pre-publication artifact. The executable
`bin/rote.js` remains present with mode `0755`.

## Receipt audit

The manifest records one `planner` usage row: 366 uncached input tokens, zero cache-read
tokens, zero cache-write tokens, and 26 output tokens. The trajectory retains one raw
OpenAI `gpt-4.1-mini` receipt with the same 366 input and 26 output tokens and a 392-token
total. Missing usage was not treated as zero.

The manifest outcome is `success`; the only trajectory event is the model's
`browser.done` conclusion. The independent visible-text result is represented by the CLI
output and success manifest rather than a second model-authored event. `stderr` is empty.

## Preserved evidence

- [Frozen protocol](data/T28-registry-smoke-protocol.json)
- [CLI stdout](data/T28-registry-smoke-stdout.txt) and [stderr](data/T28-registry-smoke-stderr.txt)
- [Run manifest](data/T28-registry-smoke-manifest.json)
- [Trajectory and raw provider receipt](data/T28-registry-smoke-trajectory.jsonl)
- [Registry metadata](data/T28-registry-metadata.json), [dist-tag](data/T28-registry-dist-tags.json), and [pack listing](data/T28-registry-pack.json)
- [Downloaded tarball SHA-256](data/T28-registry-tarball-sha256.txt)

Run `npm run reproduce:t28` to fail closed on any changed package identity, integrity,
command output, manifest/trajectory lineage, usage reconciliation, evidence digest, or
credential-shaped content.

## Limitation retained

The immutable 0.1.0 tarball's bundled README still contains candidate-era wording saying
registry publication is pending. The command and package are public and verified here;
tracked documentation is corrected for future package versions rather than rewriting the
published artifact. Version 0.1.0 also predates B4 compaction and remains the frozen P1
release, not evidence for later P2 mechanisms.
