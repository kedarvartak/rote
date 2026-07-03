# Summary

<!-- One paragraph: what this PR does and why. Link the issue if one exists. -->

**Milestone:** <!-- e.g. M1 — Recorder -->
**Exit-gate criterion advanced:** <!-- quote the relevant line from docs/06-build-plan.md, or "N/A: <reason>" -->

## Changes

<!-- Bullet list of concrete changes. One concern per PR — no drive-by refactors. -->

-

## Testing

<!-- What proves this works? Every box must be checked or struck through with a reason. -->

- [ ] Automated tests added/updated for new behavior
- [ ] Fake-world (deterministic) tests pass locally: `npm test`
- [ ] Manual test performed (describe below, or N/A for pure-logic changes)
- [ ] Any manually-found bug in this PR's scope now has an automated test

**Manual test notes:**

<!-- Commands run, environment used, what you observed. -->

## Invariants & guidelines checklist

- [ ] No path reports success on failed `verify`/`expect` (sacred invariant #1)
- [ ] Touched executor/matcher/store → added/strengthened a sacred-invariant test (or untouched)
- [ ] All LLM calls go through the tagged client wrapper
- [ ] `CHANGELOG.md` entry added under Unreleased (or PR labeled `skip-changelog`)
- [ ] Design docs (`docs/`) updated if implementation diverged from them
- [ ] Package `README.md` updated if a public API surface changed
- [ ] New dependencies justified in this description (or none added)

## Notes for reviewer

<!-- Anything you're unsure about, trade-offs made, follow-ups deferred (with issue #s). -->
