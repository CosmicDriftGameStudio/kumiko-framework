---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`r.crud`/`registerEntityCrud` gain `verbAccess?: Partial<Record<EntityCrudVerb, AccessRule>>` to gate individual verbs (e.g. `delete`/`restore`) more strictly than the shared `write`/`read` access rule. Resolution per verb: `verbAccess?.[verb] ?? (isWrite ? write?.access : read?.access)`. Existing calls without `verbAccess` are unchanged.
