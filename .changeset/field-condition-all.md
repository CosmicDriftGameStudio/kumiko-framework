---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

`FieldCondition` gains an `all` form that combines conditions on several fields with AND.

<!-- kumiko-changes
feature: screens
type: improvement
title: Field conditions can combine several fields with all
detail: `{ all: [{ field: "stage", in: ["won", "partial"] }, { field: "approval", eq: "pending" }] }` holds while every entry holds, so a row action's `visible`, `visibleWhen`, `requiredWhen` and `lockedWhen` can depend on more than one field. Entries nest, boot rejects an `all` with fewer than two entries and checks every referenced field like a single condition.
-->
