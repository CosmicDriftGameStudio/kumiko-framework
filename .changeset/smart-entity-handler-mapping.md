---
"@cosmicdrift/kumiko-framework": patch
---

Smart entity mapping for bare CRUD write handlers (`create`/`update`/`delete`):
maps to the matching entity when the feature name matches or the feature owns
exactly one entity. Boot and registry validate extension `preSave` wiring so
handlers like `credit:write:create` wire `credit-cap` without `entity:verb`
handler names or 4-segment QNs.
