#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -n "${ROTE_CURVE_CORPUS_JSON:-}" ]]; then
  actual_json="$ROTE_CURVE_CORPUS_JSON"
else
  actual_json="$(docker compose run --rm -T cli wp post list \
    --post_type=post --post_status=publish,draft,pending,private,future,trash \
    --fields=post_title,post_status --format=json)"
fi

ACTUAL_JSON="$actual_json" node <<'JS'
const actual = JSON.parse(process.env.ACTUAL_JSON);
const expected = Array.from({ length: 120 }, (_, index) => `Rote curve post ${String(index + 1).padStart(3, '0')}`).sort();
const titles = actual.map((post) => post.post_title).sort();
const unpublished = actual.filter((post) => post.post_status !== 'publish');
if (JSON.stringify(titles) !== JSON.stringify(expected) || unpublished.length > 0) {
  console.error(`corpus mismatch: expected exactly 120 published named posts; total=${actual.length}, unpublished=${unpublished.length}`);
  process.exit(1);
}
console.log('verified exact 120-post curve corpus');
JS
