---
"@cosmicdrift/kumiko-framework": minor
---

`projectionList` screens can now declare `filter` (a static `ScreenFilter`) and `facets` (a `ListFacetSpec[]` for user-toggleable select/boolean dropdowns), matching the existing `entityList` capability. The bound query handler's Zod schema must accept `filter`/`filters` params for the declared capability to reach the server — the boot-validator now checks this and throws a clear error naming the missing schema field.
