---
"@cosmicdrift/kumiko-framework": patch
---

Seed migrations can read through registered query handlers with `ctx.systemQueryAs`.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.systemQueryAs in seed migrations
detail: `SeedMigrationContext` gained `systemQueryAs(qn, payload, tenantIdOverride?, extraRoles?)`. It runs a registered query handler as the system user, chosen the same way as for `systemWriteAs`, and throws when the query fails. The seed dry run now checks query QNs as well as write QNs. Use it instead of raw SQL on `read_*` tables through `ctx.db`.
-->
