# Third-party license review

**Review date:** 2026-07-24  
**Scope:** P1 CLI package, benchmark competitors/services, and comparison material at
`41bb271` plus this review. This is an engineering inventory, not legal advice.

## Decision

**E5.5 passes for the current repository.** Browser Use is consumed as an unmodified MIT
licensed dependency, never a fork. No competitor source, logo, screenshot, generated UI,
or model weights are vendored into Rote or the npm package. Comparison docs use names and
versioned factual observations; raw benchmark artifacts are outputs from Rote's own tasks
and provider receipts.

A future competitor, copied asset, patch, or bundled dependency reopens this review.

## Published CLI contents

`@rote/cli` bundles only this repository's MIT-licensed internal workspaces. Third-party
runtime packages remain external npm dependencies and carry their own license files:

| Package resolved in lock | Role | License | Distribution treatment |
|---|---|---|---|
| `@anthropic-ai/sdk@0.110.0` | optional Anthropic provider client | MIT | external npm dependency |
| `openai@6.46.0` | default OpenAI provider client | Apache-2.0 | external npm dependency |
| `yaml@2.9.0` | playbook parser | ISC | external npm dependency |
| `zod@3.25.76` | runtime schemas | MIT | external npm dependency |
| `esbuild@0.21.5` | release bundle builder | MIT | development-only; not shipped in the tarball |

The tarball includes Rote's MIT license at `dist/LICENSE`. The automated package smoke
rejects any unresolved private `@rote/*` dependency/import. `npm audit --omit=dev` reported
zero production vulnerabilities during T14; vulnerability status and license permission
are separate checks.

## Competitor benchmark

| Component | Pinned use | License finding | Repository treatment |
|---|---|---|---|
| Browser Use | Python package `browser-use==0.13.6` | MIT classifier and packaged `licenses/LICENSE` in wheel metadata | imported out-of-process by the benchmark runner; no source modifications or vendored files |
| OpenAI Python | transitive benchmark provider client `openai==2.16.0` in the certification venv | Apache-2.0 metadata | environment dependency only; not committed or shipped |
| Stagehand | comparison/documentation only | no dependency installed | no code or assets copied |
| Skyvern | comparison/documentation only | no dependency installed | no code or assets copied |

Rote publishes the Browser Use adapter/configuration it authored, not Browser Use itself.
The raw dumps retain model usage and agent results required to audit the comparison; they
do not contain Browser Use package source.

## Benchmark services and browser

| Component | Use | Distribution decision |
|---|---|---|
| WordPress official images, digest-pinned | local G1 benchmark service; upstream GPLv2-or-later project | pulled by Docker for the benchmark, not embedded in `@rote/cli` or redistributed as an image |
| MariaDB official image, digest-pinned | local benchmark database; upstream GPLv2 project with separately licensed components | pulled by Docker, not embedded or redistributed |
| Chrome/Chromium | external CDP browser executable | user/system prerequisite; no browser binary ships in the npm tarball |

Custom WordPress MU plugins, seed scripts, fixture HTML, adapters, and reports in this
repository are Rote-authored and covered by the repository MIT license. Users who pull
container images or install browsers receive those works under their upstream terms.

## Verification record

The review used the committed npm lockfile, `npm view <exact-version> license`, installed
Python wheel `METADATA`/`licenses/LICENSE`, pinned requirements, Docker digests, and the T14
`npm pack --json` file list. Registry metadata can change; exact resolved versions and
committed pins are the reproducible identity.

## Release obligations

- Keep Rote's MIT license in every CLI tarball.
- Do not bundle external runtime libraries without preserving their required notices and
  repeating this review.
- Keep Browser Use unmodified and out-of-process unless a separately reviewed reason
  requires a fork.
- Re-run the review when dependency versions, benchmark harnesses, copied assets, or
  distribution format change.
- Treat product names as third-party marks; comparison does not imply affiliation or
  endorsement.
