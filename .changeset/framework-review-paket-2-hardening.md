---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Review hardening: confirmed SSE publish awaited by consumers, feature-toggle cache invalidation over the cache-sync bus, stream expiry timer, page-head resolver abort signal, PII backfill `failed_event_ids`, preSave output validation, read-only proxy `then`/symbol guard, no orphan-row delete in event-consumer state

<!-- kumiko-changes
feature: framework
type: fix
title: SSE broadcasts, toggle sync, stream expiry, page-head abort, PII backfill failures and preSave output are now handled strictly instead of failing silently
-->
