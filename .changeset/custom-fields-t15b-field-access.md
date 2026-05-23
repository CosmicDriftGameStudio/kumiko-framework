---
"@cosmicdrift/kumiko-bundled-features": minor
---

custom-fields: per-field `fieldAccess.write` enforcement (T1.5b).

`set-custom-field` and `clear-custom-field` handlers now read `fieldDefinition.serializedField.fieldAccess.write[]` and reject with `unprocessable` + `reason: "field_access_denied"` when the caller's roles do not intersect. Handler-level RBAC (TenantAdmin/Member) keeps applying on top.

When `fieldAccess.write` is absent or empty, behavior is unchanged — existing consumers stay green without code changes.

`serializedField` schema gains the optional `fieldAccess: { read?: string[], write?: string[] }` shape (read is reserved for T1.5c).
