---
"@cosmicdrift/kumiko-testing": minor
---

seed-user only reaches a tenant this server's seed-tenant route created

<!-- kumiko-changes
feature: testing
type: breaking
title: seed-user only reaches a tenant this server's seed-tenant route created
detail: |
  seed-user looked the tenant up via tenant:query:me and only rejected a tenant
  id that did not exist at all, so a tenant seeded by another server or
  in-process without this route's seed-tenant still got a user added. seed-user
  now checks the same seededTenantIds set as /__test/seed and rejects any other
  tenant with the same 403.
migration: Create the tenant via `seedTenant()` (the seed-tenant route) before adding users with `tenant.addUser`.
-->
