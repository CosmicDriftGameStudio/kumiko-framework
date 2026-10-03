---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

CacheSyncBus keeps tier assignments and file providers in sync across pods

A Redis-backed CacheSyncBus (one channel, envelope with origin id, echo dropped, malformed messages ignored) now carries typed invalidation topics between pods and fires a debounced resync after a Redis reconnect. Tier assignments are published after commit and reloaded on the other pods with a per-tenant out-of-order guard; the tier cache is swapped atomically on resync. The file provider resolver drops cached providers when tenant config or secrets change on any pod. Prod, worker and dev entrypoints wire one bus per process, and TierResolverPlugin.build accepts an optional cacheSync.

<!-- kumiko-changes
feature: framework
type: improvement
title: CacheSyncBus keeps tier assignments and file providers in sync across pods
-->
