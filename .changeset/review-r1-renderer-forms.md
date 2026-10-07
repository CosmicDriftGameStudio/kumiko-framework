---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-headless": patch
---

Number inputs no longer keep a typed prefix, secretMint honours tenant currency, refEntity respects real field types

A `NumberInput` draft that does not parse ("12abc", "12,5" on an integer field) now clears the value instead of leaving the last parseable prefix ("12") to be submitted. A `secretMint` screen with `currency: { kind: "tenant" }` money fields now waits for the tenant currency in both the mint and the confirm step, like `actionForm`, instead of seeding a bare `0`. `refEntity` on an `entityList` column or `entityEdit` field no longer overrides a real non-text entity field (a multi-reference stays multi, a sortable column stays sortable). The Tailwind scan skips compiled `__tests__` in `dist`.
