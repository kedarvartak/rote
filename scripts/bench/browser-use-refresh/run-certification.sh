#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
out="${BROWSER_USE_0137_CERT_OUT:-$root/bench-out/browser-use-0137-certification}"
python="${BROWSER_USE_PYTHON:-/tmp/rote-browser-use-0.13.7/bin/python}"
protocol_file="$root/scripts/bench/browser-use-refresh/certification-protocol.json"
repetitions="$(node -p "require('$protocol_file').repetitions")"
min_runs="$(node -p "require('$protocol_file').min_successful_runs")"
protocol_id="$(node -p "require('$protocol_file').protocol_id")"

if [[ ! -x "$python" ]]; then
  echo "set BROWSER_USE_PYTHON to the prepared Browser Use 0.13.7 venv python" >&2
  exit 2
fi
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required" >&2
  exit 2
fi
node scripts/bench/browser-use-refresh/verify-certification-protocol.mjs
"$python" scripts/bench/browser-use-refresh/verify-install.py
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
  echo "=== corrected B2 repetition $repetition/$repetitions · Rote → Browser Use 0.13.7 ==="
  G2_ROTE_OUT="$out/rote" G2_BROWSER_USE_OUT="$out/browser-use" \
    scripts/bench/headhead/run-next-pair.sh B2 "$repetition" \
    > >(tee "$out/B2-r$(printf '%02d' "$repetition").log") 2>&1
done

node scripts/bench/headhead/assemble-certification-evidence.mjs "$out"
evidence="$out/evidence"
node scripts/bench/browser-use-refresh/audit-certification-evidence.mjs "$evidence" "$evidence/receipt-audit.json"
commit="$(git rev-parse --short=12 HEAD)"
node packages/bench/bin/rote-bench.js competitor-records "$out/rote/raw-runs.json" \
  --harness rote --model gpt-4.1-mini --cache-adjusted true \
  --config-notes "Rote $commit cold agent, exact cache buckets, 1920x1080" --out "$evidence/rote-records.json"
node packages/bench/bin/rote-bench.js competitor-records "$out/browser-use/raw-runs.json" \
  --harness browser-use --model gpt-4.1-mini --cache-adjusted true \
  --config-notes "Browser Use 0.13.7 defaults, wheel SHA-256 2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8, exact cache buckets, 1920x1080" --out "$evidence/browser-use-records.json"
printf '%s\n' '{"subject":{"harness":"rote","records":"rote-records.json"},"competitors":[{"harness":"browser-use","records":"browser-use-records.json"}]}' >"$evidence/sources.json"
node packages/bench/bin/rote-bench.js records "$evidence/sources.json" --out "$evidence/records.json"
node packages/bench/bin/rote-bench.js launch-gate "$evidence/records.json" --subject rote --min-runs "$min_runs" | tee "$evidence/gate.md"
node packages/bench/bin/rote-bench.js g2-report "$evidence/records.json" \
  --rote-manifests "$evidence/rote-manifests.json" \
  --browser-dumps "$evidence/browser-use-dumps.json" \
  --out "$evidence/g2-report.md" --summary "$evidence/g2-summary.json" --min-runs "$min_runs" \
  --protocol-id "$protocol_id"

echo "Browser Use 0.13.7 paired certification complete: $evidence/g2-report.md"
