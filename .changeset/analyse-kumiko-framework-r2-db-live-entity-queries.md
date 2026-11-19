---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

`useQuery({ live: true })` now refetches on events of the query handler's own entity, also for camelCase entities, and `useLiveRefetch` brings the same live refetch to hooks that fetch a query themselves.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Live refetch for entity queries and custom fetch hooks
detail: The app schema's `queryLiveEntities` now lists, for every query handler mapped to an entity (`<entity>:<verb>` names and r.crud queries), that entity next to the declared `liveEntities`. A live `useQuery` on `driverNode:list` therefore listens on `driverNode` events, where the client previously derived `driver-node` from the kebab query name and never matched the SSE frame. Handlers that read other entities still declare them via `liveEntities`. New `useLiveRefetch(queryType, refetch, { enabled })` from `@cosmicdrift/kumiko-renderer` subscribes a self-fetching hook (for example an all-pages loader) to the same entities and coalesces bursts like `useQuery`.
-->
