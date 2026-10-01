---
"@cosmicdrift/kumiko-framework": patch
---

Correction to the #2979 changeset: `ctx.fetchForWriting` always scopes `handle.events` to the aggregateType

The #2979 changeset described the `aggregateType` filter as "purely additive". For `ctx.fetchForWriting` that was wrong: since that release, `handle.events` only contains events of the fetched aggregateType, even when a handler never passed an `aggregateType` option. Events of another aggregateType on the same aggregateId are no longer part of the handle. `loadAggregate` without `aggregateType` is unchanged.

<!-- kumiko-changes
feature: framework
type: breaking
title: ctx.fetchForWriting scopes handle.events to the aggregateType since the #2979 release (correction, not purely additive)
migration: |
  handle.events von ctx.fetchForWriting ist seit Einführung des aggregateType-Filters
  typ-gescoped; Handler prüfen, die Events eines anderen aggregateType auf derselben
  aggregateId erwartet haben, und diese per loadAggregate ohne aggregateType lesen.
-->
