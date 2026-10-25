---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
---

Closes four gaps in declarative screens. A drawer-hosted actionForm follows its `redirect`, `useQuery({ live: true })` listens on the handler's `liveEntities`, relatedList drawer and writeHandler toolbar actions take `params` from the parent record, and a projectionDetail `visibleWhen` can pass the route id to its query.

<!-- kumiko-changes
feature: renderer
type: improvement
title: A drawer-hosted actionForm follows its redirect
detail: After a successful submit the drawer closes, the host refetches, and a declared redirect then navigates like on the full page, without returnTo. A redirect that points at the screen the drawer sits on (no record id, no tab) does not navigate, so filters and scroll position stay. Behavior change: before, a drawer ignored redirect.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Live queries follow the handler's liveEntities
detail: useQuery({ live: true }) and InfinityList refetch on signals for the entity in the query name and for every entity the query handler declares in liveEntities, in both the declared and the kebab-case form. The app schema carries them per feature as queryLiveEntities, and a tenant feature toggle strips them with the feature. A query that reads a second entity no longer needs a name under that entity to stay live.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: relatedList drawer and writeHandler toolbar actions take params
detail: RelatedListToolbarAction kind "drawer" and kind "writeHandler" accept params as a RowFieldExtractor evaluated against the parent record, for example params with map appId to id. A drawer gets the values as prefill, a writeHandler merges them over its static payload with the extracted values winning. Without a parent record the action stays hidden.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: projectionDetail visibleWhen can pass the route id
detail: A screen-level visibleWhen takes idParam on projectionDetail. The gate then queries with the route id under that key, and boot accepts a visibleWhen query that requires exactly that input. Without idParam the empty-payload rule stays, and idParam on another screen type fails boot. A failing gate query, such as a 403 for a downgraded tenant, shows the fallback or the standard notice instead of the screen.
-->
