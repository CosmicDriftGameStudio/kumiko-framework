---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-feature-ast": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-testing": patch
---

Review fixes across the framework: free Stripe one-off checkouts, rate-limit boot check, handbook page paths, shell accessibility and PWA scope, video setup tools, pre-push install check and tenant destruction sweep locking.

<!-- kumiko-changes
feature: subscription-stripe
type: fix
title: One-off checkouts with a 100% promo code are booked
detail: A Stripe checkout session in payment mode that a 100% promo code makes free is now booked like a paid one: the handler reads the session metadata in payment mode. Sessions created before the upgrade carry no session metadata and are still discarded.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Boot fails on tenant or user rate limits without a RateLimitResolver
detail: A handler `rateLimit` with a `tenant` or `user` bucket needs a `RateLimitResolver`. Without one the server now refuses to boot and names the handlers, instead of answering the first call with a 500. Wire a Redis client on `context.redis`, pass `context.rateLimit`, or remove the option.
-->

<!-- kumiko-changes
feature: cli
type: fix
title: The handbook build writes one index.html per chapter
detail: `kumiko handbuch build` now writes each chapter to `<id>/index.html`, so chapter links resolve on static hosting without a rewrite rule.
-->

<!-- kumiko-changes
feature: guards
type: fix
title: pre-push stops in a worktree that is not installed
detail: `kumiko-pre-push` aborts before any check when it runs in a git worktree that has a `package.json` but no `node_modules`, and prints `bun install --frozen-lockfile` for that worktree. A main checkout is not affected.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: The tenant destruction sweep locks per tenant
detail: Overlapping sweeps no longer push a tenant into `destroyFailed`. Each sweep takes a session advisory lock per tenant and skips tenants another sweep holds for that tick; failed stage attempts and abandoned stages are now logged with tenant and stage.
-->
