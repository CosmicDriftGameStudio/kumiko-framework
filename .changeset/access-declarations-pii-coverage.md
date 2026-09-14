---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

The boot check for `openToAll` write handlers that accept personal data now finds personal-data fields anywhere in the input schema — inside `z.intersection`, `z.union`/`z.discriminatedUnion`, `.transform()`/`z.preprocess()`/`.pipe()`, wrappers (`.optional()`, `.nullable()`, `.default()`, `.readonly()`, `.catch()`, `z.lazy()`), nested objects such as an update's `changes`, arrays and records — not only at the top level of a `z.object`. A `personal: { of: "<ownerField>" }` field no longer needs an exception when every role in the target entity's `access.write` is `from("user:id", "<ownerField>")` and the handler declares no `escapeHatch`. Bundled `user:update` now declares `publicIntake: true` for the `displayName`/`email` it accepts in `changes`.
