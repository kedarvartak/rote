#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
out="${G2_OUT:-$root/bench-out/g2-certification}"
repetitions="${G2_REPETITIONS:-18}"
python="${BROWSER_USE_PYTHON:-}"

if [[ ! "$repetitions" =~ ^[0-9]+$ ]] || (( repetitions < 15 )); then
  echo "G2_REPETITIONS must be an integer >=15" >&2
  exit 2
fi
if [[ -z "$python" || ! -x "$python" ]]; then
  echo "set BROWSER_USE_PYTHON to the Browser Use 0.13.6 virtualenv python" >&2
  exit 2
fi
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required" >&2
  exit 2
fi
mkdir -p "$out"

node scripts/bench/headhead/serve-fixtures.mjs 8080 >"$out/fixture-server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
sleep 1
if ! kill -0 "$server" 2>/dev/null; then
  echo "fixture server failed to start; see $out/fixture-server.log" >&2
  exit 1
fi

export BROWSER_USE_PYTHON="$python"
for repetition in $(seq 1 "$repetitions"); do
  for task in B1 B2 B3; do
    echo "=== repetition $repetition/$repetitions · $task · Rote → Browser Use ==="
    G2_ROTE_OUT="$out/rote" G2_BROWSER_USE_OUT="$out/browser-use" \
      scripts/bench/headhead/run-next-pair.sh "$task" "$repetition" \
      > >(tee "$out/${task}-r$(printf '%02d' "$repetition").log") 2>&1
  done
done

node scripts/bench/headhead/assemble-certification-evidence.mjs "$out"
evidence="$out/evidence"
commit="$(git rev-parse --short=12 HEAD)"
node packages/bench/bin/rote-bench.js competitor-records "$out/rote/raw-runs.json" \
  --harness rote --model gpt-4.1-mini --cache-adjusted true \
  --config-notes "Rote $commit, exact cache buckets, 1920x1080" --out "$evidence/rote-records.json"
node packages/bench/bin/rote-bench.js competitor-records "$out/browser-use/raw-runs.json" \
  --harness browser-use --model gpt-4.1-mini --cache-adjusted true \
  --config-notes "Browser Use 0.13.6 defaults, exact cache buckets, 1920x1080" --out "$evidence/browser-use-records.json"
printf '%s\n' '{"subject":{"harness":"rote","records":"rote-records.json"},"competitors":[{"harness":"browser-use","records":"browser-use-records.json"}]}' >"$evidence/sources.json"
node packages/bench/bin/rote-bench.js records "$evidence/sources.json" --out "$evidence/records.json"
node packages/bench/bin/rote-bench.js launch-gate "$evidence/records.json" --subject rote --min-runs 15 | tee "$evidence/gate.md"
node packages/bench/bin/rote-bench.js g2-report "$evidence/records.json" \
  --rote-manifests "$evidence/rote-manifests.json" \
  --browser-dumps "$evidence/browser-use-dumps.json" \
  --out "$evidence/g2-report.md" --summary "$evidence/g2-summary.json" --min-runs 15

echo "G2 certification complete: $evidence/g2-report.md"
