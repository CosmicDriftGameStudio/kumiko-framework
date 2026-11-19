---
"@cosmicdrift/kumiko-bundled-features": patch
---

The admin boot seed keeps finding existing accounts whose blind index is blank or stale, and repairs the index.

<!-- kumiko-changes
feature: user
type: fix
title: seedAdminGuarded, seedBootstrapAdmin and ensureBootstrapAdminRoles still find accounts with a blank email_bidx
detail: With a PII KMS configured, the boot seed matches the account by decrypting the active user rows and comparing the normalized email, so a row with a NULL or stale `email_bidx` is not duplicated (offlot#112). The oldest row wins among duplicates, its blind index is recomputed through `rewriteSeededUserEmail`, and the email is stored lower case. The ownership check before granting to an existing account and the abort when a PII KMS runs without a blind-index key stay. Without a KMS the lookup is the plain normalized email lookup.
-->
