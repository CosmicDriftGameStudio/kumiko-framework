---
"@cosmicdrift/kumiko-framework": patch
---

The event-dispatcher's poll pass used a single dispatcher-wide in-flight guard, so a consumer with a slow handler (an external search index, for example) delayed the delivery of every other registered consumer until its own transaction committed. Each consumer now runs its own turn behind its own in-flight guard, bounded by a small concurrency limit so turns don't exhaust the db pool.

<!-- kumiko-changes
feature: framework
type: fix
title: A slow event consumer no longer delays every other consumer
-->
