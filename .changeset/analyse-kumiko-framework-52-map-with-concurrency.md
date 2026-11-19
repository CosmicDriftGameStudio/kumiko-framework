---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`mapWithConcurrency` is exported from `@cosmicdrift/kumiko-framework/utils`.

<!-- kumiko-changes
feature: framework
type: improvement
title: mapWithConcurrency in framework utils
detail: `mapWithConcurrency(items, limit, fn)` from `@cosmicdrift/kumiko-framework/utils` runs `fn` over `items` with at most `limit` calls in flight and returns the results in item order. After the first rejection no further items are started and the call rejects with that error. Apps that kept their own worker pool can use it; the bundled features use this one implementation.
-->
