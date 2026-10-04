---
"@cosmicdrift/kumiko-bundled-features": patch
---

Email notifications to resolved users reach the plaintext address under an active KMS

With an active PII KMS, an app's `resolveEmail` that reads the stored `user.email` returns ciphertext, and the PII guard rightly refused to send it (`recipient address is a PII ciphertext`). That broke every `notify` target that resolves an address from a user id: a single user, a list of users and `{ tenant }`. The email channel now decrypts the resolved address (`decryptStoredPii`, a no-op without KMS or for plaintext) before it is used for delivery, opt-out checks and the attempt log. The guard is unchanged.

<!-- kumiko-changes
feature: channel-email
type: fix
title: Email channel decrypts the resolved recipient address so notify to users and tenants works with an active KMS
migration: No action needed. Apps whose resolveEmail returns the raw stored user.email now send to the plaintext address instead of failing with "recipient address is a PII ciphertext".
-->
