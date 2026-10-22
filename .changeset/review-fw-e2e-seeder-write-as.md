---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
---

Signature extra routes get `deps.dispatchWriteAs({ handlerQn, payload, tenantId, roles })`, a write as the tenant's system user with the "system" role plus exactly the named roles, without SystemAdmin. E2E extra seeders get `ctx.writeAs(roles, handlerQn, payload)` bound to the seeded tenant, so a seeder can write to handlers gated on app roles without adding the role "system" to production handlers.

<!-- kumiko-changes
feature: framework
type: improvement
title: E2E seeders and signature routes can write with explicit roles
detail: dispatchWriteAs on signature route deps and writeAs on the E2E seeder context run a write as the tenant's system user with the "system" role plus the given roles, without SystemAdmin. write() keeps running as SystemAdmin.
-->
