# Changelog Instructions for Agents

Every PR should update the root `CHANGELOG.md` unless the change is truly internal and has no product, API, CLI, documentation, dependency, or developer-workflow impact.

## Where to write

Add new entries under:

```md
## [Unreleased]
```

Use one of these categories:

- `Added` for new features, commands, endpoints, files, modules, or docs.
- `Changed` for behavior, workflow, schema, config, dependency, or documentation changes.
- `Fixed` for bug fixes.
- `Removed` for deleted code, endpoints, dependencies, files, or workflows.
- `Security` for security/privacy changes.
- `Deprecated` for features that still exist but should stop being used.

## Entry style

Good entries are short, concrete, and reviewer-friendly.

Use this style:

```md
- Added `npm run agent -- discover --limit <n>` to seed dry-run startup/opening candidates into `data/run-state.json`.
```

Avoid vague entries like:

```md
- Updated backend stuff.
- Misc cleanup.
```

## What agents must mention

Mention any change that affects:

- CLI commands or output.
- API endpoints, request/response shape, validation, or error codes.
- persisted files under `data/`.
- schemas, workflow states, matching logic, outreach safety rules, or approval behavior.
- dependencies, scripts, build/test commands, or required environment variables.
- docs that future agents are expected to follow.

## PR checklist requirement

In every PR body, include a `Changelog` section with:

```md
## Changelog
- [ ] Updated `CHANGELOG.md` under `Unreleased`.
- [ ] Used the right category: Added, Changed, Fixed, Removed, Security, Deprecated.
```

If no changelog entry is needed, write:

```md
## Changelog
- [ ] Not updated: <short reason>
```

## Before merging

Verify that `CHANGELOG.md`:

- has exactly one `Unreleased` section.
- keeps newest unreleased entries at the top of each category.
- does not include local-only generated data or secrets.
- does not duplicate an existing entry.
