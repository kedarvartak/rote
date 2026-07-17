#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo 'usage: verify-trash-count.sh <expected-count>' >&2
  exit 2
fi

cd "$(dirname "$0")"
actual=$(docker compose run --rm -T cli wp eval '
$query = new WP_Query([
    "post_type" => "post",
    "post_status" => "trash",
    "s" => "Rote curve post",
    "posts_per_page" => -1,
]);
echo $query->found_posts;
' 2>/dev/null)

if [[ "$actual" != "$1" ]]; then
  echo "expected $1 trashed Rote curve posts, found $actual" >&2
  exit 1
fi

echo "verified: $actual trashed Rote curve posts"
