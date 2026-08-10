#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^http://127\.0\.0\.1:[0-9]+/?$ ]]; then
  echo 'usage: reset.sh http://127.0.0.1:<port>' >&2
  exit 2
fi

curl --fail --silent --show-error --request POST "${1%/}/api/reset"
printf '\n'
