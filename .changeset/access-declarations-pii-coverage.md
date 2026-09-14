---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

The boot check for `openToAll` write handlers that accept personal data now finds personal-data fields anywhere in the input schema — inside `z.intersection`, `z.union`/`z.discriminatedUnion`, `.transform()`/`z.preprocess()`/`.pipe()`, wrappers (`.optional()`, `.nullable()`, `.default()`, `.readonly()`, `.catch()`, `z.lazy()`), nested objects such as an update's `changes`, arrays and records — not only at the top level of a `z.object`. A field bound to the caller needs no declaration: every role in the target entity's `access.write` is `from("user:id", "<ownerField>")` for a `personal: { of: "<ownerField>" }` field, or `from("user:id", "id")` for a `personal: "self"` field, and the handler has no `escapeHatch` and its feature no `r.systemScope()`. The `publicIntake` flag is removed; a handler that lets signed-in tenant members write unbound personal data declares `openToAll: { reason, personalData: "tenant-members" }`. Bundled `user:update` now uses that declaration.
