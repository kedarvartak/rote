# Fixtures

Golden test data shared across packages and milestones.

- `playbooks/` — hand-authored Playbook YAML files used as parser fixtures and,
  from M2 onward, as real replay targets against the frozen demo environment
  (B1/B2 initially, B3 added for the M3 catalog-search smoke). The
  `browser-b1-stateful.yaml` and `browser-b2-stateful.yaml` fixtures target the local
  CDP pages and provide the verified zero-LLM warm path.
- `trajectories/` — recorded TrajectoryEvent JSONL files used as Distiller (M5)
  input fixtures. Populated starting in M1 once the Recorder exists.
- `sites/` — frozen stateful B1–B3 HTML pages: login/download confirmation, vendor submission confirmation, and query-driven catalog/product states.
- `sites/drift/` — B2 mutations covering selector renames, wrapper insertion,
  ambiguous controls, stale-selector decoys, and hidden replacements.
