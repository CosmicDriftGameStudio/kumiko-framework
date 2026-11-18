---
"@cosmicdrift/kumiko-framework": patch
---

`runMigrations` and system-mode `createTenantDb` reject two inputs they used to accept.

<!-- kumiko-changes
feature: framework
type: fix
title: runMigrations checks lockTimeoutMs, system-mode createTenantDb rejects placeholder reasons
detail: `runMigrations(db, migrations, { lockTimeoutMs })` throws a `RangeError` before taking the advisory lock when `lockTimeoutMs` is not a finite number of at least 1. `0` used to reach Postgres as `lock_timeout = 0`, which waits forever, and `NaN` as invalid SQL. `createTenantDb({ mode: "system", reason })` now applies the same placeholder check as `escapeHatch` and `unsafeRaw`: a reason like "todo", "legacy" or "n/a" throws at construction, where only an empty reason did before.
migration: Pass a `lockTimeoutMs` of at least 1 or leave it out for the default. Replace a placeholder system-mode reason with the real operator use case.
-->
