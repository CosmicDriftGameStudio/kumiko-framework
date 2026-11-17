---
"@cosmicdrift/kumiko-bundled-features": patch
---

channel-push hands `resolveToken` the typed tenant database.

<!-- kumiko-changes
feature: channel-push
type: fix
title: resolveToken receives a typed db
detail: The `ctx.db` passed to `resolveToken` is now typed as the delivery channel's `TenantDb` instead of `unknown`, so an app can query its device entity without a guard or cast. Existing callbacks that take `unknown` still compile.
-->
