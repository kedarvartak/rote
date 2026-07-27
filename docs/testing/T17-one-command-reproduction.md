# T17 — One-command collection and published-evidence reproduction

## Published evidence

`npm run reproduce:g2` now invokes the fail-closed T13 audit from a clean temporary output
directory and requires regenerated Markdown and JSON to equal the committed files
byte-for-byte. It performs no provider call:

```text
G2 reproduction passed: Markdown and JSON match T13 byte-for-byte
```

This command preserves the historical v1 artifact; byte equality does not restore T19's
withdrawn B2 claim. It runs in CI after the package smoke. Raw T13 records, manifests, trajectories,
Browser Use dumps, and provider receipts remain downloadable from
[T13](T13-g2-certification.md).

## Fresh collector smoke

Moving the published CLI bin to built-only JavaScript in #104 left the source benchmark
runner pointing at a `dist/` file that does not exist after a normal source checkout. The
Rote pair runner now invokes `packages/cli/src/cli-entry.ts` explicitly through the pinned
development TypeScript runtime; the npm package bin remains built-only.

A fresh B1 pair after that correction passed both exact live checks and retained measured
cache buckets:

```text
Rote:        logical input 2,661; output 182
Browser Use: logical input 33,910; output 756
```

- [Rote raw row](data/T17-collector-rote-raw.json)
- [Rote manifest](data/T17-collector-rote-manifests.json)
- [Rote provider receipts](data/T17-collector-rote-provider-receipts.json)
- [Browser Use raw row](data/T17-collector-browser-use-raw.json)
- [Browser Use diagnostic dump/provider receipts](data/T17-collector-browser-use-dumps.json)
- [Concise collector output](data/T17-collector-output.txt)
- [Reproduction command output](data/T17-reproduce-output.txt)

The smoke manifests/dump redact the canonical fixture password. Full T13 certification
artifacts remain the claim-bearing raw evidence; this post-package smoke publishes the
measured receipts needed to verify that the corrected source runner still accounts calls.

## Full paid collection

After the pinned Browser Use virtualenv and API key are configured, one command now owns
the fixture server, 18×B1–B3 Rote→Browser Use order, exact resume, evidence assembly,
neutralization, gate, audit, Markdown, and JSON:

```bash
BROWSER_USE_PYTHON=/tmp/rote-browser-use/bin/python \
  scripts/bench/headhead/run-certification.sh
```

The command rejects fewer than 15 requested repetitions. Completed attempts are skipped,
not replaced; incomplete append-only tails, missing receipts, identity/count mismatch,
model/cache mismatch, failed parity, or a nonpositive gate fail the run.
