---
"@cosmicdrift/kumiko-bundled-features": patch
---

Custom-fields: close a cross-tenant write on the set/clear projection. The
`customField.set`/`.cleared` apply-fns updated the host row by its global
`aggregateId` UUID only, so a member of tenant A could overwrite or clear tenant
B's `customFields` by passing B's known row UUID as `entityId`. The projection
UPDATEs now also filter `tenant_id = event.tenantId` (the same guard the
fieldDefinition-delete cleanup already uses).

Also harden the `set-custom-field` payload: `value` (a `z.unknown()`, implicitly
optional) must be present, so a missing value fails validation instead of
reaching the projection as `JSON.stringify(undefined)`.
