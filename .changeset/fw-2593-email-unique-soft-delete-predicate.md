---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

fw#2593: an explicitly declared UNIQUE index on an entity with `softDelete: true` now automatically gets the predicate `"is_deleted" = false`, so a value freed up by a soft-delete becomes reusable even when the entity's PII/blind-index isn't configured. Previously that predicate was only applied to the generated `*_bidx` twin (fw#2464); the plaintext index stayed a full unique index, so `read_users_email_unique` kept blocking email reuse whenever no blind-index key was set up. An author-provided `where` on the index definition is unchanged and still suppresses the `*_bidx` twin — that escape hatch remains the way to opt out of the auto-appended predicate. This is a pure loosening of the constraint: every row that satisfied the old full unique index still satisfies the new partial one, so no duplicate-cleanup migration is needed. Apps must run `kumiko-schema generate` to pick up the updated index definition for any entity with `softDelete: true` and an explicit unique index.
