#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo 'usage: verify-trash-posts.sh <expected-titles-json>' >&2
  exit 2
fi

canonicalize() {
  node -e '
    const titles = JSON.parse(process.argv[1]);
    if (!Array.isArray(titles) || titles.some((title) => typeof title !== "string" || title.length === 0)) process.exit(2);
    process.stdout.write(JSON.stringify([...titles].sort()));
  ' "$1"
}

expected=$(canonicalize "$1")
if [[ -n "${ROTE_CURVE_ACTUAL_TITLES_JSON:-}" ]]; then
  actual=$(canonicalize "$ROTE_CURVE_ACTUAL_TITLES_JSON")
else
  cd "$(dirname "$0")"
  raw_actual=$(docker compose run --rm -T cli wp eval '
    $query = new WP_Query([
        "post_type" => "post",
        "post_status" => "trash",
        "s" => "Rote curve post",
        "posts_per_page" => -1,
    ]);
    echo wp_json_encode(wp_list_pluck($query->posts, "post_title"));
  ' 2>/dev/null)
  actual=$(canonicalize "$raw_actual")
fi

if [[ "$actual" != "$expected" ]]; then
  echo "expected trashed posts $expected, found $actual" >&2
  exit 1
fi

echo "verified trashed posts: $actual"
