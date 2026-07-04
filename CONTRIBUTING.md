# Contributing to Rote

Thanks for your interest. This project is early and moves fast against a
milestone plan — read this before opening a PR.

## Before you start

- Read [`docs/06-build-plan.md`](docs/06-build-plan.md) for the current
  milestone. Don't build ahead of the milestone order (e.g. executor before
  matcher, matcher before distiller) — later milestones depend on earlier
  ones being proven first.
- Read [`CLAUDE.md`](CLAUDE.md) — it's the standing engineering ruleset
  (invariants, code practices, testing philosophy, PR/commit conventions)
  that applies to every contributor, human or agent.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit across all workspaces
npm run lint        # eslint .
npm test            # vitest run across all workspaces
```

Each package has its own `README.md` with package-specific test/build notes.

## Pull requests

- One milestone concern per PR — don't mix a feature with a drive-by refactor.
- Use [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md);
  fill every section.
- Add a `CHANGELOG.md` entry under `## [Unreleased]` (enforced by CI) unless
  the PR is labeled `skip-changelog`.
- Branch names: `m<N>/<short-slug>` for milestone work (e.g.
  `m3/bench-harness`), otherwise a descriptive slug (e.g. `docs/...`,
  `fix/...`).
- All CI checks green before requesting review.

## Reporting bugs / requesting features

Open a GitHub issue. For security issues, see [`SECURITY.md`](SECURITY.md)
instead — don't file those publicly.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
