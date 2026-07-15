# Security Policy

## Supported Versions

Rote is pre-release (no tagged versions yet — see `docs/05-roadmap.md` for
milestone status). Security fixes land on `main` only; there is no LTS branch
to backport to at this stage.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately via
[GitHub Security Advisories](https://github.com/kedarvartak/rote/security/advisories/new)
for this repository. Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept
- Any affected package(s) (`@rote/core`, `@rote/recorder`, `@rote/executor`,
  `@rote/cli`) and version/commit

You should expect an initial response within a few days. We'll work with you
to understand and confirm the issue, agree on a disclosure timeline, and
credit you in the fix (unless you'd prefer otherwise).

## Scope

Things especially worth flagging given what this project does:

- **Trajectory/playbook storage** — Rote records tool-call arguments and
  results (`packages/recorder`), which can include sensitive data from
  whatever downstream tools it wraps. If you find a way trajectories leak
  data they shouldn't, that's in scope.
- **The Expect DSL** (`packages/core`) is deliberately closed — no arbitrary
  code execution. Any path that lets an `expect`/`verify` block execute
  attacker-controlled code is a critical finding.
- **The replay executor** (`packages/executor`) dispatches tool calls and LLM
  completions on a playbook's behalf. Anything that lets a crafted playbook
  or param binding escape its declared tool/LLM boundary is in scope.

Dependency vulnerabilities reported by `npm audit` that are already tracked
in `CHANGELOG.md`/open PRs don't need a separate report — check there first.
