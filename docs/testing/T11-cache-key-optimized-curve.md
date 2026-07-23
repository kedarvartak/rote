# G1 cumulative logical-input curve

Protocol subject `p1-g1-wordpress-v8-tag-creation-cache-key-v1-probe`, baseline `p1-g1-wordpress-v8-tag-creation`; openai/`gpt-4.1-mini`; 15 complete matched repetitions; 95% seeded-bootstrap intervals (10,000 resamples). Costs use the 2026-07-15 published model rates (https://developers.openai.com/api/docs/pricing).

**Result: PASS.** rote cumulative logical-input growth is 37.6% slower than browser-use (35.7%–39.6%), against the public 30.0% lower-bound floor.

| Cell | Steps | Rote logical input (95% CI) | Browser Use logical input (95% CI) | Reduction (95% CI) | Success R / B |
|---|---:|---:|---:|---:|---:|
| WP-N09 | 9 | 46,960 [46,640–47,228] | 55,131 [55,115–55,146] | 14.8% [14.3%–15.4%] | 15/15 / 15/15 |
| WP-N13 | 13 | 51,175 [50,871–51,612] | 68,092 [67,280–68,520] | 24.8% [23.7%–25.7%] | 15/15 / 15/15 |
| WP-N17 | 17 | 59,983 [59,427–60,574] | 81,862 [81,441–82,094] | 26.7% [25.9%–27.5%] | 15/15 / 15/15 |
| WP-N21 | 21 | 69,909 [69,033–70,754] | 95,952 [95,860–96,053] | 27.1% [26.3%–28.0%] | 15/15 / 15/15 |
| WP-N25 | 25 | 80,101 [78,985–81,205] | 109,332 [107,767–110,138] | 26.7% [25.2%–28.0%] | 15/15 / 15/15 |

Logical input is `uncached input + cache reads + cache writes`; caching cannot masquerade as token reduction. Every run concluded and passed the independent database verifier. Failed and abandoned attempts remain in the success-rate denominator.

| Cell | Harness | Uncached input | Cache reads | Cache writes | Output | Latency p50/p95 | Mean cost |
|---|---|---:|---:|---:|---:|---:|---:|
| WP-N09 | Rote | 38,256 | 8,704 | 0 | 416 | 35.1s / 42.5s | $0.0168 |
| WP-N09 | Browser Use | 23,822 | 31,309 | 0 | 1,239 | 31.0s / 47.8s | $0.0146 |
| WP-N13 | Rote | 20,898 | 30,276 | 0 | 465 | 35.4s / 49.0s | $0.0121 |
| WP-N13 | Browser Use | 29,444 | 38,647 | 0 | 1,786 | 44.4s / 69.5s | $0.0185 |
| WP-N17 | Rote | 43,480 | 16,503 | 0 | 635 | 48.4s / 54.2s | $0.0201 |
| WP-N17 | Browser Use | 34,306 | 47,556 | 0 | 2,196 | 57.0s / 99.0s | $0.0220 |
| WP-N21 | Rote | 51,118 | 18,790 | 0 | 808 | 59.9s / 71.6s | $0.0236 |
| WP-N21 | Browser Use | 40,571 | 55,381 | 0 | 2,487 | 60.2s / 79.7s | $0.0257 |
| WP-N25 | Rote | 50,379 | 29,722 | 0 | 931 | 72.5s / 87.9s | $0.0246 |
| WP-N25 | Browser Use | 46,408 | 62,925 | 0 | 2,770 | 76.0s / 118.1s | $0.0293 |

At WP-N25, Rote's mean billed cost is 16.0% lower and its p50 latency is 4.6% lower. Browser Use receives more discounted cache reads, so cost is reported independently from logical-token growth.

A4 emitted 842 diffs (median 24 chars) and 240 grounded bootstraps (median 9270 chars). Relative to each diff's preceding grounded bootstrap, the median render-size reduction was 99.6%.

