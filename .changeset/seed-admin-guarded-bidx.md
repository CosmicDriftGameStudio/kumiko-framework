---
"@cosmicdrift/kumiko-bundled-features": minor
---

`seedAdminGuarded`: boot-seed guard against KMS blind-index misses (mirrors offlot#114)

New additive export in `@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding`. `seedAdmin`'s idempotency check is a plain `fetchOne(email)`, which under KMS encryption can only match via the `email_bidx` companion column — so it misses whenever a row's blind index is `NULL` (written before the key existed, or after a subject-key erase) or was computed with a since-rotated key, causing `seedAdmin` to insert a second row for an email that already has an account. `seedAdminGuarded` scans and decrypts active user rows to find the true canonical account (oldest `insertedAt`, tie-broken by `id`) before falling back to `seedAdmin`, and reconciles tenant + membership onto it instead of duplicating. Boot-seed callers only — `seedUser`/`seedAdmin`/`provisionSignupAccount` are unchanged and remain the entry point for the self-signup hot path.
