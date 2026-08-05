---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`InfinityList` now subscribes to SSE events for the entity parsed from its `query` prop (same `<feature>:query:<entity>:<verb>` convention as `useQuery`'s `live` option) and refetches only the first page on any create/update/delete/restore event, merging the fresh rows in by `rowId` instead of collapsing the already-accumulated pages — a full reload would jump the scroll position. New `live` prop, default `true`. `entityFromQueryType` is now exported from `@cosmicdrift/kumiko-renderer` so `InfinityList` can reuse it instead of duplicating the parsing logic.
