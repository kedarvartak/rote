# G1 cumulative logical-input curve

Protocol `p1-g1-wordpress-v8-tag-creation`; openai/`gpt-4.1-mini`; 15 complete matched repetitions; 95% seeded-bootstrap intervals (10,000 resamples). Costs use the 2026-07-15 published model rates (https://developers.openai.com/api/docs/pricing).

**Result: PASS.** rote cumulative logical-input growth is 37.2% slower than browser-use (35.6%–38.8%), against the public 30.0% lower-bound floor.

| Cell | Steps | Rote logical input (95% CI) | Browser Use logical input (95% CI) | Reduction (95% CI) | Success R / B |
|---|---:|---:|---:|---:|---:|
| WP-N09 | 9 | 47,204 [47,000–47,316] | 55,104 [55,048–55,140] | 14.3% [14.1%–14.7%] | 15/15 / 15/15 |
| WP-N13 | 13 | 51,068 [50,896–51,366] | 68,455 [68,399–68,499] | 25.4% [25.0%–25.7%] | 15/15 / 15/15 |
| WP-N17 | 17 | 60,331 [59,600–61,054] | 82,152 [82,082–82,208] | 26.6% [25.7%–27.5%] | 15/15 / 15/15 |
| WP-N21 | 21 | 69,476 [68,591–70,399] | 95,888 [95,798–95,975] | 27.5% [26.6%–28.5%] | 15/15 / 15/15 |
| WP-N25 | 25 | 81,203 [80,195–82,130] | 110,131 [110,023–110,223] | 26.3% [25.4%–27.2%] | 15/15 / 15/15 |

Logical input is `uncached input + cache reads + cache writes`; caching cannot masquerade as token reduction. Every run concluded and passed the independent database verifier. Failed and abandoned attempts remain in the success-rate denominator.

| Cell | Harness | Uncached input | Cache reads | Cache writes | Output | Latency p50/p95 | Mean cost |
|---|---|---:|---:|---:|---:|---:|---:|
| WP-N09 | Rote | 46,222 | 981 | 0 | 429 | 34.4s / 45.6s | $0.0193 |
| WP-N09 | Browser Use | 23,360 | 31,744 | 0 | 1,215 | 30.6s / 39.1s | $0.0145 |
| WP-N13 | Rote | 44,958 | 6,110 | 0 | 454 | 40.5s / 76.9s | $0.0193 |
| WP-N13 | Browser Use | 28,775 | 39,680 | 0 | 1,714 | 39.9s / 60.8s | $0.0182 |
| WP-N17 | Rote | 54,682 | 5,649 | 0 | 670 | 50.7s / 59.1s | $0.0235 |
| WP-N17 | Browser Use | 34,536 | 47,616 | 0 | 2,204 | 51.8s / 71.7s | $0.0221 |
| WP-N21 | Rote | 62,769 | 6,707 | 0 | 787 | 61.6s / 106.0s | $0.0270 |
| WP-N21 | Browser Use | 40,635 | 55,253 | 0 | 2,368 | 57.2s / 89.8s | $0.0256 |
| WP-N25 | Rote | 70,827 | 10,377 | 0 | 1,007 | 72.0s / 85.2s | $0.0310 |
| WP-N25 | Browser Use | 46,575 | 63,556 | 0 | 2,760 | 67.7s / 100.3s | $0.0294 |

At WP-N25, Rote's mean billed cost is 5.4% higher despite using fewer logical-input tokens, because Browser Use receives substantially more discounted cache reads. Rote's p50 latency is 6.4% higher. G1 is a logical-token growth claim, not a cost or latency win.

A4 emitted 849 diffs (median 24 chars) and 240 grounded bootstraps (median 9270 chars). Relative to each diff's preceding grounded bootstrap, the median render-size reduction was 99.6%.

