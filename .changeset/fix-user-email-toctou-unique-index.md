---
"@cosmicdrift/kumiko-bundled-features": patch
---

fw#2134: `user:create`'s duplicate-email check was a pure pre-flight `fetchOne` — two concurrent creates with the same email could both pass the check and both insert (TOCTOU). `userEntity` now declares `indexes: [{ columns: ["email"], unique: true, name: "read_users_email_unique" }]`; since `email` is `lookupable: true`, this makes the framework generate a real partial unique index over the deterministic `email_bidx` column, which the DB itself enforces. A losing concurrent create now hits that constraint and surfaces as a clean 409 `unique_violation` (via the existing F8 pg-23505 mapping), remapped in the handler to the same `emailAlreadyExists` error shape the pre-flight already returns.

**Consumer migration note:** apps that bump past this version and run `kumiko migrate generate` will get a new unique-index migration. If a consumer's `read_users` table already holds duplicate emails (from before this fix), that migration will fail to apply until the duplicates are resolved. A soft-deleted-but-not-yet-forgotten user still holds its email slot until `forget` runs and nulls its `email_bidx`.
