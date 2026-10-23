---
"@cosmicdrift/kumiko-bundled-features": patch
---

The sessions integration tests change memberships and user status through handlers or the event-store executor.

<!-- kumiko-changes
feature: sessions
type: improvement
title: Sessions tests no longer write projection tables directly
detail: The sessions integration tests change tenant memberships and user status through the update-member-roles handler or the event-store executor instead of writing into the projection tables. Nothing changes for apps; the package is only republished.
-->
