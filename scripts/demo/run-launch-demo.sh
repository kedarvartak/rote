#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required" >&2
  exit 2
fi
port="${ROTE_DEMO_PORT:-8094}"
mkdir -p "$root/bench-out"
out="${ROTE_DEMO_OUT:-$(mktemp -d "$root/bench-out/launch-demo-XXXXXX")}"
mkdir -p "$out"
base="$out/.rote"
candidate="$out/b1-candidate.json"
drift="$out/drifted-sites"
cli="$root/packages/cli/bin/rote.js"
task="$(node scripts/demo/read-b1-config.mjs task)"
params="$(node scripts/demo/read-b1-config.mjs params)"
url="http://127.0.0.1:$port/b1-report.html"
verify='Report download complete: quarterly-report.pdf'
server=''

stop_server() {
  if [[ -n "$server" ]]; then kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; server=''; fi
}
start_server() {
  node scripts/demo/serve-directory.mjs "$1" "$port" >"$out/server.log" 2>&1 &
  server=$!; sleep 1
  if ! kill -0 "$server" 2>/dev/null; then echo "demo server failed; see $out/server.log" >&2; exit 1; fi
}
trap stop_server EXIT

npm run build --workspace @rote/cli >/dev/null
start_server "$root/fixtures/sites"

echo '=== 1/3 cold: compact planner explores and verifies ==='
ROTE_BASE_DIR="$base" "$cli" run "$task" --url "$url" --verify-text "$verify" \
  --model gpt-4.1-mini --max-steps 8 --viewport-width 1920 --viewport-height 1080

"$cli" candidate create fixtures/playbooks/browser-b1-stateful.yaml --url "$url" \
  --params "$params" --out "$candidate" >/dev/null

echo '=== 2/3 warm: exact candidate replays with zero model tokens ==='
ROTE_BASE_DIR="$base" "$cli" run "$task" --url "$url" --verify-text "$verify" \
  --model gpt-4.1-mini --max-steps 8 --viewport-width 1920 --viewport-height 1080 \
  --replay-candidate "$candidate"

node scripts/demo/prepare-drift.mjs "$root/fixtures/sites" "$drift" >/dev/null
stop_server
start_server "$drift"

echo '=== 3/3 drift: stale assertion fails, classified cold fallback verifies ==='
ROTE_BASE_DIR="$base" "$cli" run "$task" --url "$url" --verify-text "$verify" \
  --model gpt-4.1-mini --max-steps 8 --viewport-width 1920 --viewport-height 1080 \
  --replay-candidate "$candidate"

echo "demo artifacts: $out"
