---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`registeredEntityExecutor(registry, entityName)` returns a cached executor for an entity the registry knows.

<!-- kumiko-changes
feature: framework
type: improvement
title: Cached executor for a registered entity
detail: `registeredEntityExecutor(registry, entityName)` from `@cosmicdrift/kumiko-framework/engine` looks the entity up in the registry and returns its event-store executor, or `undefined` when no feature registered it. The executor is built once per entity definition and name and then reused, so code that reaches an optional feature's entity by name no longer builds a table and an executor on every call or pairs a name with a definition by hand. It covers the same zero-config case as `createEntityExecutor`; an executor with a search adapter is still built with `createEventStoreExecutor`. Parent visibility, document link targets and the document import use it.
-->
