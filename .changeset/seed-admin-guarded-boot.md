---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Boot admin seed no longer duplicates the admin when the email blind-index lookup misses (fw#3101)

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Boot admin seed no longer duplicates the admin when the email blind-index lookup misses (fw#3101)
detail: |
  runProdApp and runDevApp used to call the unguarded `seedAdmin`, whose idempotency check is a plain email fetchOne that the query layer rewrites into `(email = $plaintext OR email_bidx = $hmac)` once a blind-index key is configured. Under KMS encryption `email` holds per-row ciphertext, so only the bidx arm can ever match — and it misses whenever a row's `email_bidx` is NULL (written before the key existed, or after a subject-key erase), silently inserting a second admin account for the same email. Both boot paths now call `seedAdminGuarded`, which under KMS decrypt-scans the active users for the email and reuses the oldest matching row instead of duplicating it. `seedAdminGuarded` also now aborts with a named error if a PII KMS is configured but no blind-index key is — that combination makes the lookup blind by construction — and reconciles `emailVerified: true` onto the existing row it resolves through the decrypt-scan branch, matching the existing-row reconcile `seedUser` already does on its own idempotency hit.
-->
