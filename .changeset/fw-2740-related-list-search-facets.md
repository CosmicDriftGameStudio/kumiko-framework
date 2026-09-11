---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
---

fw#2740: `relatedList` sections on `projectionDetail` gain `searchable` and `facets`, over the exact same payload/facet path as `projectionList` — no second SQL path, no read-side hack. Search rides along as `payload.search` and facet selections as `payload.filters` on the section's own query. Both are opt-in and validated at boot against the bound query's Zod schema, same as `projectionList.searchable`/`facets`. Facet resolution is shared with `projectionList` via `resolveProjectionFacetSpecs`/`buildFilterPayload` (moved to their own module to avoid a require cycle with `related-list-section.tsx`) — no duplicate implementation. Search term and filter selections live in local component state rather than URL state, since a section's `id` is optional and has no stable URL key to namespace against.
