# @rote/distiller

Trajectory → playbook distiller: tier-1 (episodic) memory for Rote. It reads one
successful browser-agent run recorded by `@rote/agent`'s `FileBrowserAgentRunRecorder`
and emits a `Playbook` (`@rote/core`) that the replay executor runs with zero model
calls, zero human edits, and the action-contract gate (#143) intact. It is
deterministic: no LLM call, no inference — anything it cannot derive it prunes visibly or
refuses.

## Public API

- `distillTrajectory(events, options)` — pure. Keeps only events whose post-action evidence
  exists (evidence is derived after dispatch, so it is the record that the action
  executed); prunes `done`, pre-dispatch failures, unknown tools, and superseded
  fill/select writes on the same target (last write wins) — every pruned event is
  reported with a reason. Each step carries the *resolved* selector, stableId, role/name,
  contextHash, and the recorded `actionContract`; `expect` comes only from strong evidence
  (fill/select value, navigate URL path) — reaction-only evidence never becomes an
  assertion. Every declared param value is replaced by `{{name}}` in dispatched values,
  URLs, expectations, and the intent text; a fill/select value that matches no param
  fails with `UnparameterizedValueError` (naming the step, never the value) unless
  `literalValues: 'allow'` is passed. `verify` is caller-declared. Returns a
  `DistillReport` (playbook, kept, pruned, contractedStepIds, usedParams).
- `loadRecordedRun(baseDir, runId)` — I/O edge: reads `runs/<id>/manifest.json` and
  `trajectory.jsonl`, resolves inline/blob results, and refuses runs whose outcome is not
  `success`.

## Gate

`docs/05-roadmap.md` P2 item 8: distilled playbooks replay the fixture suite with zero
human edits — B1 (login + download) and B2 (registration) recorded through the real loop,
distilled, and replayed through the CDP executor in real Chrome with zero LLM calls;
credentials and form values never survive in the YAML; the same distilled playbook
replays across a selector rename and stops before a contract change.

## Running tests

```bash
npm test --workspace @rote/distiller
npm run test:distill-chrome --workspace @rote/distiller   # requires Chrome/Chromium
```
