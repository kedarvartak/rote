# Browser Use serializer captures

Place the exact model-facing Browser Use observation text for each frozen fixture here as
`b1.txt`, `b2.txt`, and `b3.txt`. Capture with the same Browser Use version/configuration
and document that version in the benchmark report or PR; do not hand-author or pad these
files. They are intentionally absent until a real Browser Use run produces them.

Then run:

```bash
node packages/bench/bin/rote-bench.js serializer-report \
  scripts/bench/browser-use-serializer-spec.example.json \
  --out /tmp/rote-serializer-report.md
node packages/bench/bin/rote-bench.js serializer-gate \
  scripts/bench/browser-use-serializer-spec.example.json
```

The current comparison uses the same explicit `ceil(chars / 4)` approximation for both
serializers. Provider-billed tokens remain part of the W5 end-to-end benchmark.
