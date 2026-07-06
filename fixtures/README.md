# Fixtures

Golden test data shared across packages and milestones.

- `playbooks/` — hand-authored Playbook YAML files used as parser fixtures and,
  from M2 onward, as real replay targets against the frozen demo environment
  (B1/B2 initially, B3 added for the M3 catalog-search smoke).
- `trajectories/` — recorded TrajectoryEvent JSONL files used as Distiller (M5)
  input fixtures. Populated starting in M1 once the Recorder exists.
