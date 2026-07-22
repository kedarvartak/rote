#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 '<expected-reviewed-post-titles-json>'" >&2
  exit 2
fi

cd "$(dirname "$0")"
expected_json="$1"
if [[ -n "${ROTE_CURVE_POSTS_JSON:-}" ]]; then
  actual_json="$ROTE_CURVE_POSTS_JSON"
else
  actual_json="$(docker compose run --rm -T cli wp post list \
    --post_type=post --post_status=publish,draft,pending,private,future,trash \
    --fields=post_title,post_content,post_status --format=json)"
fi

EXPECTED_JSON="$expected_json" ACTUAL_JSON="$actual_json" node <<'JS'
const reviewed = new Set(JSON.parse(process.env.EXPECTED_JSON));
const actual = JSON.parse(process.env.ACTUAL_JSON);
const expectedTitles = new Set(Array.from({ length: 120 }, (_, index) => {
  const base = `Rote curve post ${String(index + 1).padStart(3, '0')}`;
  return reviewed.has(base) ? `${base} — reviewed` : base;
}));
const failures = [];
for (const post of actual) {
  if (!expectedTitles.delete(post.post_title)) failures.push(`unexpected title ${JSON.stringify(post.post_title)}`);
  const match = /^Rote curve post (\d{3})(?: — reviewed)?$/.exec(post.post_title);
  const expectedContent = match ? `Procurement record ${match[1]} for the deterministic Rote working-memory benchmark.` : '';
  if (post.post_status !== 'publish') failures.push(`${post.post_title} status=${post.post_status}`);
  if (post.post_content !== expectedContent) failures.push(`${post.post_title} content mismatch`);
}
if (expectedTitles.size > 0) failures.push(`missing titles=${JSON.stringify([...expectedTitles])}`);
if (failures.length > 0 || actual.length !== 120) {
  console.error(`reviewed-post verification failed: ${failures.join('; ')}; total=${actual.length}`);
  process.exit(1);
}
console.log(`verified reviewed posts: ${JSON.stringify([...reviewed].sort())}`);
JS
