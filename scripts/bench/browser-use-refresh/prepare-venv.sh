#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
VENV=${1:-/tmp/rote-browser-use-0.13.7}
DOWNLOAD_DIR=$(mktemp -d)
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT

python3 -m venv "$VENV"
"$VENV/bin/pip" download --no-deps browser-use==0.13.7 --dest "$DOWNLOAD_DIR"
WHEEL="$DOWNLOAD_DIR/browser_use-0.13.7-py3-none-any.whl"
printf '%s  %s\n' '2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8' "$WHEEL" | sha256sum --check --status
"$VENV/bin/pip" install "$WHEEL"
"$VENV/bin/python" "$ROOT/scripts/bench/browser-use-refresh/verify-install.py"
