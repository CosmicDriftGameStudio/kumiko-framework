---
"@cosmicdrift/kumiko-framework": patch
---

insertMany (and so seedRows) no longer drops fields that only a later row sets.

<!-- kumiko-changes
feature: framework
type: fix
title: insertMany takes the column list from all rows
detail: `insertMany` built its column list from the first row only, so a field set by a later row (for example `isDeleted: true` through `seedRows`) was silently dropped or written as NULL. The column list is now the union over all rows; a row that omits a column gets DEFAULT, like a single `insertOne` without that key.
-->
