---
"@cosmicdrift/kumiko-framework": patch
---

A migration waiting for a table lock fails after 10 seconds instead of hanging the deploy.

<!-- kumiko-changes
feature: migrations
type: improvement
title: Migrations fail fast on a blocked table lock
detail: The migration runner disables `statement_timeout`, so a migration queued behind a long query or open transaction on its table waited forever. Each migration transaction now sets `lock_timeout` to 10 seconds and fails with `MigrationLockTimeoutError`, which names the migration. Waiting for another runner's advisory lock is unchanged. `runMigrations` takes `{ lockTimeoutMs }` as third argument.
-->
