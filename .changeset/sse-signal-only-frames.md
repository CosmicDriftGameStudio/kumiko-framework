---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
---

Live updates over `/api/sse` no longer carry field values. A frame now holds only the entity, the event type, id, version and createdAt, and clients load the data with a query, which runs its own access check. Anonymous connections receive signals only for entities that an anonymously callable query declares through the new `liveEntities` option on a query handler. Frames without an entity, such as in-app notifications, now go only to the addressed user. `createSseRoute` takes a second argument with the entities that anonymous connections may follow, and `collectAnonymousLiveEntities(registry)` computes it. Boot fails when `liveEntities` names an unknown entity.

<!-- kumiko-changes
feature: framework
type: breaking
title: /api/sse sends change signals without field values; anonymous connections only for declared entities
detail: |
  The SSE broadcast consumer no longer puts the event payload (changes, previous) on the tenant channel, because that channel fans out to every tenant member and to anonymous connections. Entity frames carry `{ id, aggregateType, eventType, version, createdAt }`. Anonymous connections get entity signals only for entities named by an anonymously callable query via the new `liveEntities` option; the query name alone grants nothing, because a signal carries the id of every row, including rows the query filters out. Frames without an entity are delivered only when `data.userId` matches the connected user. Boot fails when `liveEntities` names an unregistered entity.
migration: |
  Code that reads `data.payload` from SSE frames must load the data with a query after the signal instead. Public pages that update anonymously add `liveEntities: ["<entity>"]` to the anonymous query they refetch (for example a `page:current` query), otherwise the live update stays off for anonymous visitors. `createSseRoute(broker)` now needs a second argument, `{ anonymousLiveEntities: collectAnonymousLiveEntities(registry) }`.
-->

<!-- kumiko-changes
feature: renderer
type: breaking
title: LiveEvent data has no payload, it carries eventType
detail: |
  `LiveEvent.data` is now `{ id, aggregateType, eventType, version, createdAt }`. The server sends signals only, so consumers refetch through a query.
migration: |
  Replace reads of `event.data.payload` with a query refetch. `useQuery({ live: true })` already does this and needs no change.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: EventSource live events parse the signal-only frame
detail: |
  `createEventSourceLiveEvents` forwards the new frame shape without payload and with `eventType`.
migration: |
  No code change needed.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: Query handlers can declare liveEntities
detail: |
  `QueryHandlerDefinition` and the inline `queryHandler` options accept `liveEntities`, the entities whose changes the query reflects. Anonymous callers with access to the query receive /api/sse change signals for them.
migration: |
  No code change needed.
-->
