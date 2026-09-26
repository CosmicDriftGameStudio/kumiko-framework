---
"@cosmicdrift/kumiko-testing": minor
---

tenant.addUser accepts a displayName/email identity; seedTenant's auto-login is documented on the fixture type

<!-- kumiko-changes
feature: testing
type: improvement
title: tenant.addUser accepts an optional displayName/email identity
detail: |
  seedTenant()'s admin already accepted `admin: { displayName, email }`, but
  `tenant.addUser(roles)` (the seed-user route and the in-process seedTenant
  alike) had no such parameter and always fell back to `Seed <hash>` /
  `user-<uuid>@example.test`, which then leaked into screenshots and docs
  (solon, money-horse). `addUser(roles, { displayName, email })` now threads
  an optional identity through to the created user row, the same
  `SeedAdminIdentity` shape the admin already uses. Also: the seedTenant
  fixture logging the shared Playwright `context` in as the tenant admin was
  previously documented only in a code comment in auth-kit.ts — it is now on
  the `SeedTenantFixture` type's own JSDoc.
-->
