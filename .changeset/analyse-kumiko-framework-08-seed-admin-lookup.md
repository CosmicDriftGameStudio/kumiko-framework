---
"@cosmicdrift/kumiko-bundled-features": minor
---

The admin boot seed finds an existing account through the blind index and no longer decrypts every user row on each boot.

<!-- kumiko-changes
feature: user
type: breaking
title: seedAdminGuarded uses the indexed email lookup and rewriteSeededUserEmail is removed
detail: `seedAdminGuarded`, `seedBootstrapAdmin` and `ensureBootstrapAdminRoles` decrypted all active user rows on each boot to find accounts whose `email_bidx` was NULL and rewrote that email to repair the index. They now look the account up by normalized email through the blind index, like `seedAdmin`. The ownership check before granting to an existing account and the abort when a PII KMS runs without a blind-index key stay. `rewriteSeededUserEmail` is removed from `@cosmicdrift/kumiko-bundled-features/user/seeding` and `/user/testing`.
migration: User rows with a NULL `email_bidx` are no longer found or repaired by the seed; re-save such rows before upgrading. Tests that blank the blind index to provoke the old repair path are deleted.
-->
