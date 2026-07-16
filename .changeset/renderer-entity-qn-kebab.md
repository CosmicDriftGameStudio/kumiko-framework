---
"@cosmicdrift/kumiko-renderer": patch
---

entityList / entityEdit / reference lookups now kebabize feature + entity when building query/write QNs (matches server `qualifyEntityName`). Client-safe `toKebab` in `app/qn.ts` — do not import from `/engine` (browser bundle). Fixes camelCase entities (e.g. `driverModel`) returning `errors.notFound` in the UI.
