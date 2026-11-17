---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`recordSubjectsOwnedByUser` finds the record subjects of rows a user owns through `personal: { of, whenAbsent: "self" }` fields; erasing their keys on forget is opt-in via `eraseSubjectData({ eraseOwnedRecordKeys: true })`.

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: Opt-in shredding of the ownerless phase of self-keyed fields on owner forget
detail: A field declared `personal: { of: "<ownerField>", whenAbsent: "self" }` is encrypted under the row's own record key while the owner is empty. After the owner is set the row is rekeyed, but the created event keeps the earlier ciphertext. `recordSubjectsOwnedByUser(db, features, userId)` is exported from `@cosmicdrift/kumiko-framework/db` and returns each such row's record subject with the row's tenant (soft-deleted rows included, rows already hard-deleted are out of reach). `eraseSubjectData` returns them only with the opt-in `eraseOwnedRecordKeys: true`; by default forgetting a user erases no record key beyond what it erased before.
-->
