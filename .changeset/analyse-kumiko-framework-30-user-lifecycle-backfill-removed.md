---
"@cosmicdrift/kumiko-bundled-features": minor
---

user-data-rights drops the one-time lifecycle backfill and reports its export configuration error in English.

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: backfillUserLifecycleEvents removed
detail: `backfillUserLifecycleEvents` is removed from `@cosmicdrift/kumiko-bundled-features/user-data-rights`. It recorded lifecycle state set by the old raw update path as `user.updated` events, a one-time step before re-enabling `read_users` rebuilds that no install needs any more. The error for `sendExportReadyEmail` without `appExportDownloadUrl` now reads "sendExportReadyEmail is set but appExportDownloadUrl is missing — configure both together".
migration: Remove calls to `backfillUserLifecycleEvents`. Lifecycle changes go through `updateUserLifecycle`, which already writes `user.updated` events.
-->
