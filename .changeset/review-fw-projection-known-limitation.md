---
"@cosmicdrift/kumiko-framework": patch
---

Projection rebuild: mark the cutover seam as `__test_onBeforeFence` so a production caller can't accidentally hold the ACCESS-EXCLUSIVE fence open (#404/5). Document a known limitation (#443) — a cross-aggregate write that commits with an event id below the rebuild cursor after the cursor passed it is dropped (bigserial assigns ids pre-commit); add a deterministic characterization test pinning the data-loss until a watermark-based fix lands.
