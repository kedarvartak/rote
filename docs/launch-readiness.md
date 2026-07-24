# P1 launch readiness

**Decision on 2026-07-24: BLOCKED — do not announce or tag a release yet.**

The repository-controlled launch work is complete. Registry-backed installation is not:
the unscoped `rote` name belongs to another project, this environment is not logged into
npm, and ownership of the intended `@rote` scope is unconfirmed. That is tracked in
[#107](https://github.com/kedarvartak/rote/issues/107).

## Gate walk

| Gate | Status | Evidence |
|---|---|---|
| G1 real-page curve | pass | [T10](testing/T10-g1-cumulative-token-curve.md): lower 95% slope-reduction bound 35.6%, above 30%, at 75/75 parity per harness |
| OpenAI cache economics | qualified with short-cell loss | [T11](testing/T11-cache-key-economics.md): WP-N25 cost win; WP-N09 interval crosses parity |
| G2 tokens/task level | pass with B2 catalog miss | [T13](testing/T13-g2-certification.md): 108/108 sessions; all formal intervals positive; B2 below 80% target |
| CLI package shape | pass | [T14](testing/T14-cli-package-candidate.md): build, pack, clean install, bin, live data URL and B1 |
| Failed replay fallback | pass with rollback limit | [T15](testing/T15-replay-fallback.md): failed cheap path remains failed; cold fallback verifies |
| Runnable terminal demo | pass | [T16](testing/T16-launch-demo.md): cold → explicit zero-token replay → real drift detection/full fallback |
| One-command evidence reproduction | pass in CI | [T17](testing/T17-one-command-reproduction.md): T13 Markdown/JSON byte-identical |
| Known limitations | published | [Known limitations](known-limitations.md) linked from README |
| Competitor/dependency license review | pass | [Third-party review](third-party-licenses.md): Browser Use is an unmodified MIT dependency, not a fork |
| Typecheck, lint, sacred invariants, package/script tests | pass | mandatory CI |
| Registry-backed `npx` with only provider key | **BLOCKED** | #107 |

## Exact release closure

A maintainer with the chosen npm scope must perform these steps; none may be inferred from
a 404 response:

1. Confirm scope ownership with an authenticated npm account and document the final package
   name. Do not silently substitute an unrelated or opportunistic name.
2. From current `main`, run `npm ci && npm test && npm run build`.
3. Run `npm pack --workspace @rote/cli --json` and compare its contents with the T14
   allowlist: `README.md`, `bin/rote.js`, `dist/*`, `dist/LICENSE`, `package.json`.
4. Publish 0.1.0 with public access. Publishing is append-only; do not reuse a version after
   a partial or incorrect release.
5. In an empty directory with no checkout, run the README data-URL command through
   registry-backed `npx <confirmed-package>@0.1.0`. It must independently verify and leave
   a valid manifest/trajectory.
6. Publish that receipt as the next numbered testing record, check the final roadmap box,
   mark E5.1/E5.6 done, and only then tag/announce P1.

## Not launch blockers, still not claims

Anthropic cache economics, formal B5 repair certification, recall-stress coverage,
scheduled compaction, distillation, automatic matching, site memory, model routing, and
speculation remain deferred. The launch is tier-0 working memory, not learned memory.

The product website in PR #101 is useful collateral but is not allowed to override this
technical gate. A green website PR cannot turn an unpublished package into a launch.
