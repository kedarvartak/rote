# E3 provider-cache economics

Before `p1-g1-wordpress-v8-tag-creation`; after `p1-g1-wordpress-v8-tag-creation-cache-key-v1-probe`; baseline `p1-g1-wordpress-v8-tag-creation`; openai/`gpt-4.1-mini`; 15 successful runs per harness/cell. Costs use the 2026-07-15 published rates (https://developers.openai.com/api/docs/pricing).

The fresh after/baseline matrix preserves G1 ordering: repetition outermost, checkpoints shortest-to-longest, and Rote immediately followed by Browser Use for every cell. The frozen before matrix remains unchanged. The cache key adds no prompt text.

| Cell | Rote cost before | Rote cost after | Cost reduction (95% CI) | Browser Use cost | Rote vs Browser Use (95% CI) | Cache reads before → after | Hit-call rate before → after |
|---|---:|---:|---:|---:|---:|---:|---:|
| WP-N09 | $0.0193 | $0.0168 | 12.6% [1.7%–24.6%] | $0.0146 | -15.0% [-29.4%–1.3%] | 981 → 8,704 | 3.4% → 7.5% |
| WP-N13 | $0.0193 | $0.0121 | 37.2% [22.2%–49.7%] | $0.0185 | 34.4% [20.2%–46.5%] | 6,110 → 30,276 | 11.7% → 18.8% |
| WP-N17 | $0.0235 | $0.0201 | 14.7% [2.3%–27.2%] | $0.0220 | 8.8% [-2.6%–21.7%] | 5,649 → 16,503 | 8.0% → 13.5% |
| WP-N21 | $0.0270 | $0.0236 | 12.6% [5.0%–21.6%] | $0.0257 | 8.3% [0.3%–17.5%] | 6,707 → 18,790 | 11.5% → 28.2% |
| WP-N25 | $0.0310 | $0.0246 | 20.5% [11.3%–30.3%] | $0.0293 | 16.0% [6.2%–26.2%] | 10,377 → 29,722 | 15.1% → 27.6% |

At WP-N25, stable cache routing cuts Rote's mean bill by 20.5% (11.3%–30.3%) and makes it 16.0% cheaper than Browser Use (6.2%–26.2%). Logical input remains separately reported and is not relabeled as a cache saving.

