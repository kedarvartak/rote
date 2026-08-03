#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
out="${POST_ACTION_EVIDENCE_OUT:-$root/bench-out/post-action-evidence-qualification}"
protocol="$root/scripts/bench/post-action-evidence/protocol.json"
repetitions="$(node -p "require('$protocol').repetitions")"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required" >&2
  exit 2
fi
if ! git diff --quiet "$(node -p "require('$protocol').rote_commit")" -- packages/action/src packages/agent/src; then
  echo "action/agent implementation differs from the protocol-pinned Rote commit" >&2
  exit 2
fi
node - <<'NODE'
const protocol = require('./scripts/bench/post-action-evidence/protocol.json');
const tasks = require('./scripts/bench/headhead/tasks.json');
if (tasks.provider !== protocol.provider || tasks.model !== protocol.model || JSON.stringify(tasks.viewport) !== JSON.stringify(protocol.viewport)) throw new Error('canonical provider/model/viewport changed');
if (JSON.stringify(tasks.tasks.map((task) => task.id)) !== JSON.stringify(protocol.tasks)) throw new Error('canonical task scope changed');
NODE
mkdir -p "$out"
node scripts/bench/headhead/serve-fixtures.mjs 8080 >"$out/fixture-server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
sleep 1
if ! kill -0 "$server" 2>/dev/null; then
  echo "fixture server failed to start; see $out/fixture-server.log" >&2
  exit 1
fi
for repetition in $(seq 1 "$repetitions"); do
  for task in B1 B2 B3; do
    echo "=== post-action evidence · $task · repetition $repetition/$repetitions ==="
    node --import tsx/esm scripts/bench/headhead/rote/run_once.ts \
      --out "$out/rote" --task "$task" --repetition "$repetition" --resume
  done
done
node scripts/bench/post-action-evidence/assemble-evidence.mjs "$out"
node scripts/bench/post-action-evidence/summarize-qualification.mjs "$out/evidence" \
  "$out/evidence/report.md" "$out/evidence/summary.json" "$protocol"
