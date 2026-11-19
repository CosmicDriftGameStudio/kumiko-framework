---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`decryptPiiFieldValues` looks up each subject's key once per call, and the members and team list decrypt a user's email and display name with one key lookup.

<!-- kumiko-changes
feature: framework
type: improvement
title: One KMS key lookup per subject when decrypting several PII fields
detail: `decryptPiiFieldValues` used to call `kms.getKey` once per encrypted field, so a row with an email and a display name of the same user cost two key-store round trips. It now memoizes the key per subject within one call; an erased subject still yields the erased sentinel for all of its fields, and there is still no cache across calls, so an erased key holds on every pod immediately. bundled-features adds `decryptStoredPiiFields` next to `decryptStoredPii`, and the tenant members and team list queries use it, which halves the key lookups of these lists.
-->
