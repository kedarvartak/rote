# E7.1 enterprise contract corpus

This is a **qualification fixture**, not an enterprise feature claim. It freezes synthetic
adversarial pages, lifecycle units, and independently queried exact outcomes before E7.2–E7.7
choose identity, traversal, evidence, action, endurance, or continuation mechanisms.

## Frozen contract

`protocol.json` is `p2-enterprise-contract-corpus-v1`. Its 19 cases cover:

- repeated and virtualized grids with deliberate role/name/depth collisions;
- nested same-origin and cross-origin frames plus stale-frame remounts;
- nested open shadow roots and a closed-root typed unsupported boundary;
- hover, Control+Enter, allowlisted text upload, drag/drop, and browser download controls;
- no-op plus unrelated DOM mutation, stale evidence, and other-task evidence;
- exactly 60 single-session SPA transitions with routes, remounts, virtual rows, and
  unrelated background requests;
- a separately reported three-checkpoint continuation fixture across two browser-process
  restarts.

Every positive case names either exact task-bound server events with payload SHA-256 values
(raw dispatched values are discarded) or an exact browser download filename/content SHA-256. Every negative case requires a typed
failure with `dispatch_count: 0`. Harness conclusion and generic DOM change are prohibited
success signals. `claims_allowed` is empty.

## Run locally

```bash
npm exec -- tsx scripts/bench/enterprise/serve.ts
# In another terminal, using the printed primary origin:
scripts/bench/enterprise/reset.sh http://127.0.0.1:<port>
```

The server listens on two random loopback origins, injects those origins into otherwise
byte-stable fixtures, and keeps authoritative state outside the DOM. Query exact state with:

```bash
curl 'http://127.0.0.1:<port>/api/oracle?task_id=grid-contract&generation=1'
```

Run schema/server tests without Chrome:

```bash
npm test --workspace @rote/bench -- enterprise-contract enterprise-oracle
```

Run the repeated real-Chrome fixture control smoke:

```bash
npm run test:enterprise-chrome --workspace @rote/bench
```

The Chrome smoke manipulates fixture controls directly; it does not claim Rote can yet
resolve or dispatch through those contexts. E7.2–E7.5 must implement against this frozen
corpus, E7.6 must certify the single-session cell, and E7.7 remains blocked on distiller v1.
