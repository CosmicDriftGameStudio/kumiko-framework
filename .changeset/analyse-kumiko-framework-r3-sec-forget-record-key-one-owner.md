---
"@cosmicdrift/kumiko-framework": minor
---

An entity whose fields fall back to the row's record key (`whenAbsent: "self"`) may no longer declare `recordOwned` fields or a second owner field for them.

<!-- kumiko-changes
feature: crypto-shredding
type: breaking
title: A record key that an owner forget erases holds only that owner's data
detail: Forgetting a user erases the record key of every row whose owner field holds that user, because the created event keeps the values written while the row had no owner. A `recordOwned` field (`personal: { of: "id" }`) or a `whenAbsent: "self"` field of a second owner field on the same entity sits under that key too, so the erase destroyed the record's own data or another person's, also on rows kept by a `blockDelete` retention. Boot now fails with `pii/record-key-one-owner` when an entity combines `personal: { of: "<ownerField>", whenAbsent: "self" }` with a `recordOwned` field, or uses `whenAbsent: "self"` with more than one owner field.
migration: Give the owner-keyed fields `whenAbsent: "tenant"`, use one owner field for all `whenAbsent: "self"` fields, or keep the record's own data on a separate entity. No bundled feature is affected.
affects: whenAbsent, recordOwned
-->
