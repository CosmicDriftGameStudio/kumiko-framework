---
"@cosmicdrift/kumiko-bundled-features": patch
---

`forgetOwnRowsDeleteHook` is exported from `user-data-rights-defaults` and erases a user's rows across several owner fields.

<!-- kumiko-changes
feature: user-data-rights-defaults
type: improvement
title: forgetOwnRowsDeleteHook erases rows on any owner field
detail: Apps no longer need their own loop of listing rows, forgetting each one and throwing on failure. `forgetOwnRowsDeleteHook({ entityName, table, executor, ownerFields })` from `@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults` returns an EXT_USER_DATA delete hook that forgets, through the executor, every row of the tenant whose owner field (default `userId`) holds the erased user. Soft-deleted rows are included, a row that matches several owner fields is forgotten once, and the hook forgets under both the delete and the anonymize strategy, so use it only for rows that belong wholly to the users it names. `featureName` is optional and only gates hooks for optional source features. The user-data-rights recipe shows it on an event-sourced mute entity.
-->
