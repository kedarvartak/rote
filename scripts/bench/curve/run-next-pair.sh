#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <checkpoint> <repetition>" >&2
  exit 2
fi

checkpoint="$1"
repetition="$2"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
rote_out="${ROTE_CURVE_OUT:-$root/bench-out/curve/rote.jsonl}"
browser_use_out="${BROWSER_USE_CURVE_OUT:-$root/bench-out/curve/browser-use}"
python="${BROWSER_USE_PYTHON:-/tmp/rote-browser-use/bin/python}"

rote_probe=()
if [[ "${ROTE_CACHE_LAYOUT_PROBE:-0}" == "1" ]]; then
  rote_probe+=(--cache-layout-probe)
fi

# INVARIANT: pinning both harnesses to the same repetition means a retry skips a
# completed first side instead of advancing it and destroying run-order pairing.
node --import tsx/esm "$root/scripts/bench/curve/rote/run-curve.ts" \
  --out "$rote_out" --checkpoint "$checkpoint" --repetition "$repetition" \
  --resume --max-new-runs 1 "${rote_probe[@]}"

"$python" "$root/scripts/bench/curve/browser-use/run_curve.py" \
  --out "$browser_use_out" --checkpoint "$checkpoint" --repetition "$repetition" \
  --resume --max-new-runs 1
