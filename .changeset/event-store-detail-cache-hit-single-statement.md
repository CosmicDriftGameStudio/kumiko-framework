---
"@cosmicdrift/kumiko-framework": patch
---

Entity detail cache hits with an ownership clause use one statement

<!-- kumiko-changes
feature: framework
type: improvement
title: A detail() cache hit with an ownership predicate costs one database statement
detail: The ownership re-check and the live stream-version read for a cached detail row now run as a single query, so a cache hit is no more expensive than a cache miss for entities with SQL ownership rules.
-->
