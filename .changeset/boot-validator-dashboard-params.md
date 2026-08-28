---
"@cosmicdrift/kumiko-framework": patch
---

The boot validator now allows a `navigate` rowAction's `params` extractor to target a `dashboard` screen when that screen declares a `filter`, and checks that the extractor's produced keys include the filter's `id` — a typo like `tenant` instead of `tenantId` now fails at boot instead of silently landing on an empty dashboard. A `dashboard` target with no `filter` is still rejected, since there params would be a genuine no-op.
