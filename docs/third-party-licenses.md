# Third-party license review

**Review date:** 2026-08-04
**Scope:** P1 CLI package; Browser Use 0.13.6/0.13.7, Stagehand 3.7.1, Skyvern 1.0.47, and Magnitude 0.3.1 benchmark adapters; benchmark services; and comparison material. This is an engineering inventory, not legal advice.

## Decision

**E5.5 passes for the current repository.** Browser Use and Stagehand are consumed as unmodified MIT-licensed benchmark dependencies, never forks. Skyvern is run as an unmodified, digest-pinned AGPL-3.0 container and is not redistributed by Rote. No competitor source, logo, screenshot, generated UI, or model weights are vendored into Rote or the npm package. Comparison docs use names and
versioned factual observations; raw benchmark artifacts are outputs from Rote's own tasks
and provider receipts.

A future competitor, copied asset, patch, or bundled dependency reopens this review.

## Published CLI contents

`@rotehq/cli` bundles only this repository's MIT-licensed internal workspaces. Third-party
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
| Browser Use | historical Python package `browser-use==0.13.6`; refresh wheel `browser_use-0.13.7-py3-none-any.whl` SHA-256 `2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8`, source `f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc` | MIT classifier and packaged `LICENSE` in wheel metadata; upstream MIT `LICENSE` at both pins | imported out-of-process by isolated benchmark runners; no source modifications or vendored files; not shipped in `@rotehq/cli` |
| OpenAI Python | transitive benchmark provider client `openai==2.16.0` in the certification venv | Apache-2.0 metadata | environment dependency only; not committed or shipped |
| Stagehand | npm package `@browserbasehq/stagehand==3.7.1`, integrity-pinned in `scripts/bench/stagehand/package-lock.json` | MIT package metadata | isolated feasibility adapter only; no source modifications or copied assets; not shipped in `@rotehq/cli` |
| Skyvern | unmodified `v1.0.47` image index `sha256:ad58d950f1c8cc3bc2d442228f701243b80b84494f11bbb066347ed034006e77`; source commit `9fc0b2aee079ee34ae3cdb578ca346f06c733218f` | upstream AGPL-3.0 `LICENSE` at the pinned source commit | Docker pulls the upstream image for isolated feasibility only; Rote publishes its own Compose/runner configuration and generated benchmark artifacts, not the image or Skyvern source; not shipped in `@rotehq/cli` |
| Magnitude | unmodified `magnitude-core@0.3.1`, npm integrity `sha512-kfwfc8D4qo1JMcROhXRgPS1FTXPbtQnI8tHGJ2AXMDdUZWiD8+VHgHHBJcss0s/PqSkDmaaj4XOKzK0+iSwx0w==`; npm `gitHead` `f1b587c4173d8242bdb551991de54e70c4d2faf3` is no longer reachable from rewritten upstream refs | Apache-2.0 package metadata; integrity-pinned registry tarball is the reproducible identity | isolated cold-feasibility adapter only; package and transitive dependencies remain under the benchmark directory, are not modified or vendored, and do not ship in `@rotehq/cli` |

Rote publishes the Browser Use, Stagehand, Skyvern, and Magnitude adapter/configuration it authored, not the harnesses themselves.
The raw dumps retain model usage and agent results required to audit the comparison; they
do not contain Browser Use package source.

## Benchmark services and browser

| Component | Use | Distribution decision |
|---|---|---|
| WordPress official images, digest-pinned | local G1 benchmark service; upstream GPLv2-or-later project | pulled by Docker for the benchmark, not embedded in `@rotehq/cli` or redistributed as an image |
| MariaDB official image, digest-pinned | local benchmark database; upstream GPLv2 project with separately licensed components | pulled by Docker, not embedded or redistributed |
| PostgreSQL 14 Alpine image, digest-pinned | isolated Skyvern qualification database; upstream PostgreSQL License plus image components | pulled by Docker, not embedded or redistributed |
| Chrome/Chromium | external CDP browser executable | user/system prerequisite; no browser binary ships in the npm tarball |

Custom WordPress MU plugins, seed scripts, fixture HTML, adapters, and reports in this
repository are Rote-authored and covered by the repository MIT license. Users who pull
container images or install browsers receive those works under their upstream terms.

## Verification record

The review used the committed npm lockfiles, `npm view <exact-version> license`, installed
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
