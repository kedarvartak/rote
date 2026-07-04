# @rote/recorder

A stdio MCP proxy that wraps a downstream MCP server, forwards every message
unmodified, and taps `tools/call` traffic into a `TrajectoryEvent` per call
plus a `RunManifest` at session end. See `docs/02-architecture.md`
"Recorder" and `docs/06-build-plan.md` (M1) for the design behind this.

The proxy must be **observationally invisible**: every line from the
downstream is written to the client before it is ever inspected, so recording
can never gate, delay, or alter what the client sees.

## Public API

See `src/index.ts`. Highlights:

- **`runProxy(config, clientIn, clientOut)`** — the orchestrator. Spawns the
  downstream command, tees both directions line-by-line, and writes
  `.rote/runs/<runId>/{trajectory.jsonl,manifest.json,blobs/}`.
- **`buildTrajectoryEvent`** — pure: decides inline vs. blob storage for a
  tool result and shapes the `TrajectoryEvent`.
- **`fingerprintFromToolsList`** — pure: builds the session's `EnvFingerprint`
  from a `tools/list` result.
- **`tryParseJsonRpcLine` / `isRequest` / `isResponse`** — pure JSON-RPC line
  classification; never throws, so a malformed line is simply not recorded
  (still forwarded raw).
- **`runPaths` / `blobPath` / `runsRootDir`** — pure path layout.
- **`appendTrajectoryEvent`, `writeBlob`, `writeRunManifest`** — the I/O edges.
- **`rote-record <downstream-command> [args...]`** bin — reads
  `ROTE_TARGET_IDENTITY` (required), `ROTE_TASK_SPEC`, `ROTE_RUN_ID`,
  `ROTE_BASE_DIR` from the environment.

## Known v1 limitations (tracked, not silently missing)

- **Fingerprint capture is reactive, not proactive.** The proxy captures the
  `EnvFingerprint` from the *client's own* first `tools/list` response rather
  than issuing its own probe request — this avoids needing to perform (or
  wait on) an MCP `initialize` handshake itself. It assumes the client
  requests `tools/list` early in the session, which is true of every MCP
  client (it needs the list to plan). If a session never calls `tools/list`,
  the manifest falls back to an empty-inventory fingerprint rather than
  failing.
- **`outcome` is a tool-boundary heuristic, not a task-level judgment.** The
  recorder only sees tool calls, not agent intent, so `outcome: 'failure'` is
  scoped to "the downstream process exited non-zero, or at least one
  recorded call carried an error" — never a claim about whether the task
  itself succeeded. Automatic task detection is explicitly out of scope for
  v1 (`ROTE_TASK_SPEC` is caller-supplied).
- **A killed session leaves no manifest, by design.** If the process is
  killed before session end, `manifest.json` is simply absent — this is the
  signal that the run was abandoned, rather than fabricating an outcome the
  recorder can't actually observe. `trajectory.jsonl` itself stays valid up
  to the last fully-written, fsync'd event regardless (see
  `test/invariants/append-only.test.ts`).
- **The `rote-record`/`rote` bin scripts relay into a `node --import tsx/esm`
  child** so the CLI runs straight from TS source without requiring a
  monorepo build first. `SIGINT`/`SIGTERM`/`SIGHUP` sent to the relay's PID
  are forwarded to the worker; `SIGKILL` cannot be forwarded by any process,
  relay or not — that gap is inherent, not introduced by this design.
- Token usage accounting is out of scope here — the recorder can't see LLM
  calls at the tool boundary. The benchmark harness (M3) supplies a sidecar
  usage file.

## Running tests

```bash
npm test --workspace @rote/recorder
```

Tests spawn a real fake downstream (`test/fixtures/fake-downstream.mjs`, a
plain script, not TS) as a child process, and drive `runProxy` over in-memory
streams standing in for the client — see `test/helpers/proxy-session.ts`.
