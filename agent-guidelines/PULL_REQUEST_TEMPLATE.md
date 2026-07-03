# Pull Request Template for Agents

Use this template for every PR. Be specific, concise, and verifiable. Do not claim tests passed unless you ran them.

## Title

Use an action-oriented title:

```txt
<type>: <short description>
```

Examples:

- `feat: add dry-run discovery command`
- `fix: validate run-state status transitions`
- `docs: add changelog instructions for agents`

Recommended types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

## PR Body

Copy this structure into the PR body:

```md
## Summary
- 
- 
- 

## Changelog
- [ ] Updated `CHANGELOG.md` under `Unreleased`.
- [ ] Used the right category: Added, Changed, Fixed, Removed, Security, Deprecated.
- [ ] Entry is user/reviewer-facing and mentions important agent/CLI/API behavior.

## Validation
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Other/manual: 

## Risk / Rollback
- Risk: low | medium | high
- Rollback plan: 

## Notes for Reviewer
- 
```

## Agent Rules

- Keep summaries outcome-focused, not implementation-noisy.
- Mention new commands, endpoints, schemas, persisted files, migrations, and behavior changes.
- Include validation output in plain language.
- If a validation step was not run, say `Not run` and explain why.
- If the PR intentionally skips `CHANGELOG.md`, explain why in the Changelog section. This should be rare and limited to repo-only maintenance with no behavior/documentation impact.
- Do not include secrets, personal profile data, generated local state, or provider credentials.
