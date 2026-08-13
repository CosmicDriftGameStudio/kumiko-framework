---
"@cosmicdrift/kumiko-framework": minor
---

`event-store-executor.list()` silently dropped `payload.search` when no `SearchAdapter` was wired (neither at build time via `options.searchAdapter` nor at runtime via `runtimeOptions.searchAdapter`) — the list came back unfiltered, indistinguishable from a real search result. Now throws `UnprocessableError` (`code: "unprocessable"`, `details.reason: "search_adapter_not_wired"`, `details.entity`) instead.

**Breaking for consumers whose entities are `searchable` but have no `SearchAdapter` wired**: a search request that used to silently no-op now returns a 422. Wire a `SearchAdapter` (e.g. Meilisearch) for the entity, or stop marking the field/screen `searchable`.
