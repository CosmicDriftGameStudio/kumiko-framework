---
"@cosmicdrift/kumiko-bundled-features": patch
---

The team list reads only the newest session per member for the last-seen time.

<!-- kumiko-changes
feature: tenant
type: improvement
title: Team list reads only the newest session per member
detail: tenant:query:team:list loads the last-seen time with one query that returns one row per member, instead of loading every session of every member and picking the newest in memory. The result is unchanged.
-->
