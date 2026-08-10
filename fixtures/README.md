# Fixtures

Golden test data shared across packages and milestones.

- `playbooks/` — hand-authored Playbook YAML files used as parser fixtures and,
  from M2 onward, as real replay targets against the frozen demo environment
  (B1/B2 initially, B3 added for the M3 catalog-search smoke). The
  `browser-b1-stateful.yaml` and `browser-b2-stateful.yaml` fixtures target the local
  CDP pages and provide the verified zero-LLM warm path.
- `trajectories/` — recorded TrajectoryEvent JSONL files used as Distiller (M5)
  input fixtures. Populated starting in M1 once the Recorder exists.
- `sites/` — frozen stateful B1–B3 HTML pages: login/download confirmation, vendor submission confirmation with all eight requested values in one exact terminal
  oracle, and query-driven catalog/product states.
- `sites/drift/` — component B2 mutations covering selector renames, wrapper insertion,
  ambiguous controls, stale-selector decoys, and hidden replacements.
- `sites/b2-vendor-drift.html` — full eight-field B5 fixture with query-selected field,
  submit, wrapper, destructive-decoy, and ambiguity mutations under the exact T20 oracle.
- `enterprise/` — E7.1's synthetic contract corpus: repeated/virtualized grids, nested
  same/cross-origin frames, nested open and closed shadow roots, complex controls, and a
  60-transition SPA with explicit restart checkpoints. Fixture DOM status is diagnostic;
  exact outcomes live in the separate `EnterpriseFixtureServer` oracle state.
