#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <B1|B2|B3> <repetition>" >&2
  exit 2
fi

task="$1"
repetition="$2"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
rote_out="${G2_ROTE_OUT:-$root/bench-out/g2/rote}"
browser_out="${G2_BROWSER_USE_OUT:-$root/bench-out/g2/browser-use}"
python="${BROWSER_USE_PYTHON:-/tmp/rote-browser-use/bin/python}"

# INVARIANT: each side durably records this exact attempt before the next pair;
# retrying skips completed rows rather than changing repetition identity.
node --import tsx/esm "$root/scripts/bench/headhead/rote/run_once.ts" \
  --out "$rote_out" --task "$task" --repetition "$repetition" --resume

"$python" "$root/scripts/bench/headhead/browser-use/run_browser_use.py" \
  --out "$browser_out" --task "$task" --repetition "$repetition" \
  --resume --max-new-runs 1
