---
"@cosmicdrift/kumiko-framework": minor
---

Entity events are versionable: eventVersion + eventMigrations on r.entity

Entities can declare eventVersion and row-shaped eventMigrations; lifecycle events are stamped with the version and upcast on rebuild and aggregate load. A version bump invalidates entity snapshots.

<!-- kumiko-changes
feature: framework
type: improvement
title: Entity events are versionable: eventVersion + eventMigrations on r.entity
-->
