---
"@cosmicdrift/kumiko-framework": patch
---

`checkWriteFieldOwnership` now only evaluates fields the caller actually submitted, not fields a `preSave` hook derived afterward. Previously, a hook that set an ownership-restricted field the user never touched (e.g. a system hook deriving `assignedTo`) caused that write to be wrongly rejected with `ownership_denied`, even though the user never wrote that field. A checked field's rule is still evaluated against the full post-hook row, so a rule referencing a hook-derived column (e.g. an `authorId` a hook sets, used to gate a different user-submitted field) keeps working exactly as before.
