---
"@cosmicdrift/kumiko-testing": minor
---

Seed routes: SystemAdmin is seedable, and apps can register their own seeders

<!-- kumiko-changes
feature: testing
type: improvement
title: Seed routes seed a SystemAdmin and run app-owned seeders
detail: |
  SystemAdmin is now one of the built-in seedable roles. This reverses the
  earlier "SystemAdmin is never seedable" rule: the seed gate
  (KUMIKO_TEST_SEED=1, never under NODE_ENV=production, per-run token) is now
  the only boundary around the seed routes. `tenant.addUser(["SystemAdmin"])`
  (seed-user route and in-process seedTenant alike) stores SystemAdmin as a
  global user role, never as a membership role; without a tenant role the user
  joins the tenant as Member so the login has a membership.
  `createE2eSeedRoutes({ extraRoles: ["SystemAdmin"] })` no longer throws.
  `createE2eSeedRoutes({ extraSeeders: { name: (ctx, tenantId, body) => … } })`
  mounts POST /__test/seed behind the same gate; the flow calls
  `tenant.seed(name, body)` on the seedTenant fixture. Only tenants seeded by
  that server's seed-tenant route are accepted (403 otherwise), unknown names
  are a 404, `body` arrives as `unknown` and a ZodError from the seeder becomes
  a 400. `ctx.write`/`ctx.query` run as the tenant's system user (SystemAdmin)
  and are bound to that tenant, so the target handler must admit SystemAdmin;
  there is no raw DB access.
-->
