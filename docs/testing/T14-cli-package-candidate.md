# T14 — CLI package candidate and clean-install smoke

## Result

`@rote/cli@0.1.0` now packs as a self-contained public-package candidate: internal
`@rote/*` workspaces are bundled, the executable runs built JavaScript without `tsx`, and
only the four third-party runtime libraries remain dependencies. A clean temporary npm
project installed the 98,602-byte tarball and executed its `rote` bin successfully.

A second clean-install probe used the tarball—not the monorepo—to complete the exact B1
fixture against OpenAI `gpt-4.1-mini`:

```text
success: task verification passed
phase: cold
steps: 5
tokens: 2661 input + 186 output
```

The documented data-URL quickstart also passed directly from that clean installation in
one step with 366 input + 24 output tokens. These runs required Node 20+, an installed
Chrome/Chromium, and `OPENAI_API_KEY`; no source checkout, TypeScript runtime, internal
workspace package, fixture server for the data-URL case, or additional secret was used.

## Registry decision

The desired unscoped npm name `rote` is already owned by an unrelated routing library at
version 1.0.0. The scoped package `@rote/cli` returned 404 on 2026-07-24, but this machine
has no npm login and cannot prove ownership of the `@rote` scope. Therefore this change
does **not** claim a registry publish or a working registry-backed `npx` command.

After the maintainer confirms scope ownership and authenticates npm, the intended command
is:

```bash
npx @rote/cli@0.1.0 run "<task>" \
  --url "<url>" --verify-text "<independent success text>"
```

Until then, E5.1 is package-ready but registry-blocked. Substituting an unreviewed package
name after discovering the collision would be a product decision disguised as build work.

## Reproduction

The deterministic package smoke builds, packs, installs into an empty temporary project,
and invokes the installed bin:

```bash
npm ci
npm run test:package
```

The package adds `esbuild` as a development-only dependency so one publishable CLI can
contain the internal workspaces without publishing ten private packages or shipping a
TypeScript runtime. OpenAI, Anthropic, Zod, and YAML remain ordinary external runtime
dependencies so npm security updates are not hidden inside the bundle.

Evidence:

- [`npm pack --json` metadata and file list](data/T14-cli-package-pack.json)
- [verified B1 live-run manifest](data/T14-cli-package-live-manifest.json)
- [verified B1 trajectory and provider receipts](data/T14-cli-package-live-trajectory.jsonl)
- [one-step data-URL quickstart manifest](data/T14-cli-quickstart-manifest.json)
- [one-step data-URL trajectory and provider receipt](data/T14-cli-quickstart-trajectory.jsonl)

The tarball itself is intentionally not committed: `npm run test:package` rebuilds it from
tracked source and deletes its temporary installation.
