---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Seeds can call write handlers that declare a `rateLimit`

The seed and seed-migration dispatcher of `runProdApp` had no `RateLimitResolver`, so any handler with a `rateLimit` failed with an internal error when a seed called it. Seeds now always run with `createUnlimitedRateLimitResolver()` (exported from `@cosmicdrift/kumiko-framework/pipeline`), even when the app has a real resolver: they are bootstrap writes, so they neither fail on a limit nor drain the buckets real requests use. Requests are limited as before.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Seeds no longer fail on write handlers that declare a rateLimit
detail: The seed dispatcher gets an unlimited RateLimitResolver instead of none; requests keep the app's resolver and limits.
-->
