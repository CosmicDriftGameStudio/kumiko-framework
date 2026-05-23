---
"@cosmicdrift/kumiko-bundled-features": minor
---

custom-fields: user-data-rights wiring (T1.5c).

New `wireCustomFieldsUserDataRightsFor(r, { entityName, entityTable, userIdColumn })` opt-in helper. Registers a second `r.useExtension(EXT_USER_DATA, ...)` for the host entity whose hooks handle the customFields jsonb under DSGVO Art. 15+17+20:

- **Export**: every row owned by the user contributes its customFields jsonb into the export bundle under `<entity>.customFields`.
- **Forget anonymize**: sensitive customFields keys (declared via `serializedField.sensitive: true`) are stripped from the jsonb. Non-sensitive keys stay.
- **Forget delete**: no-op — the host entity's own user-data-rights hook removes the row, jsonb travels with it.

`serializedField` gains optional `sensitive: boolean` alongside `fieldAccess` (T1.5b).
