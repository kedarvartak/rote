#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
docker compose run --rm -T cli wp eval-file /seed.php >/dev/null
./verify-corpus.sh >/dev/null
./verify-trash-count.sh 0 >/dev/null
echo 'Restored all 120 Rote curve posts to their deterministic published state.'
