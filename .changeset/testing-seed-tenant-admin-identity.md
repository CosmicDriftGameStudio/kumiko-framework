---
"@cosmicdrift/kumiko-testing": minor
---

`seedTenant` accepts an admin identity (displayName/email) for demo and screenshot tenants (fw#3118)

<!-- kumiko-changes
feature: testing
type: improvement
title: seedTenant accepts an admin identity (displayName/email) for demo and screenshot tenants
detail: |
  SeedTenantOptions gained an optional `admin: { displayName?, email? }`.
  email supports a `{tenantId}` placeholder, substituted per call, so a
  fixed template (e.g. `admin+{tenantId}@example.test`) stays unique across
  the global `read_users_email_unique` index instead of colliding across
  per-scenario tenants. Threaded through both the plain seed-tenant.ts path
  and the HTTP seed route/fixture.
-->
