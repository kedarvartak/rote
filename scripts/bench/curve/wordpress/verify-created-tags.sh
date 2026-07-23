#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 '<expected-tag-names-json>'" >&2
  exit 2
fi

cd "$(dirname "$0")"
./verify-corpus.sh >/dev/null
expected_json="$1"
if [[ -n "${ROTE_CURVE_TAGS_JSON:-}" ]]; then
  actual_json="$ROTE_CURVE_TAGS_JSON"
else
  actual_json="$(docker compose run --rm -T cli wp term list post_tag \
    --fields=name,slug,description,count --format=json)"
fi

EXPECTED_JSON="$expected_json" ACTUAL_JSON="$actual_json" node <<'JS'
const expectedNames = JSON.parse(process.env.EXPECTED_JSON);
const actual = JSON.parse(process.env.ACTUAL_JSON);
const expected = new Map(expectedNames.map((name) => {
  const match = /^Rote certification tag (\d{2})$/.exec(name);
  if (!match) throw new Error(`invalid expected tag name: ${JSON.stringify(name)}`);
  return [name, {
    slug: `rote-certification-tag-${match[1]}`,
    description: `Deterministic certification marker ${match[1]}.`,
  }];
}));
const failures = [];
for (const tag of actual) {
  const wanted = expected.get(tag.name);
  if (!wanted) {
    failures.push(`unexpected tag ${JSON.stringify(tag.name)}`);
    continue;
  }
  expected.delete(tag.name);
  if (tag.slug !== wanted.slug) failures.push(`${tag.name} slug=${JSON.stringify(tag.slug)}`);
  if (tag.description !== wanted.description) failures.push(`${tag.name} description=${JSON.stringify(tag.description)}`);
  if (Number(tag.count) !== 0) failures.push(`${tag.name} count=${tag.count}`);
}
if (expected.size > 0) failures.push(`missing tags=${JSON.stringify([...expected.keys()])}`);
if (failures.length > 0 || actual.length !== expectedNames.length) {
  console.error(`created-tag verification failed: ${failures.join('; ')}; total=${actual.length}`);
  process.exit(1);
}
console.log(`verified created tags: ${JSON.stringify(expectedNames)}`);
JS
