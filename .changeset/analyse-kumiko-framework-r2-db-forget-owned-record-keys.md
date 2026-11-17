---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Forgetting a user now also erases the record keys of rows the user owns through `personal: { of, whenAbsent: "self" }` fields, so values written while the row had no owner become unreadable in the event history too.

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: Owner forget shreds the ownerless phase of self-keyed fields
detail: A field declared `personal: { of: "<ownerField>", whenAbsent: "self" }` is encrypted under the row's own record key while the owner is empty. After the owner is set the row is rekeyed, but the created event keeps the earlier ciphertext. `crypto-shredding:write:forget-subject` for a user and the user-data-rights forget cleanup now look up every row whose owner field holds that user (soft-deleted rows included, rows already hard-deleted are out of reach) and erase each row's record key next to the user key. Such an entity has no `recordOwned` field and one owner field for its `whenAbsent: "self"` fields, so the record key holds only that owner's data. `recordSubjectsOwnedByUser(db, features, userId)` is exported from `@cosmicdrift/kumiko-framework/db` and returns each row's record subject with the row's tenant.
-->
