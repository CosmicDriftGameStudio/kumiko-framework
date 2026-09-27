---
"@cosmicdrift/kumiko-framework": patch
---

Boot validator no longer warns about a user-reference-named field (e.g. `authorId`) that another field of the same entity already names as its owner via `personal: { of: "<field>" }`

<!-- kumiko-changes
feature: framework
type: fix
title: No user-reference-name warning for owner fields referenced via personal.of
detail: |
  The `PII_USER_REFERENCE_NAME_HINTS` boot warning checked each field in isolation, so an owner field such as `authorId` kept warning even when a content field on the same entity already declared `personal: { of: "authorId" }`, the exact silencing condition the warning itself names. The validator now collects the owner fields referenced via `personal.of` per entity first and skips the warning for them. Fields with a user-reference-typical name that no `personal.of` references still warn.
-->
