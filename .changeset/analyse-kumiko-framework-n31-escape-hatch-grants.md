---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-feature-ast": minor
---

`escapeHatch` requires `grants`; a declaration without them no longer unlocks all four grants.

<!-- kumiko-changes
feature: framework-core
type: breaking
title: escapeHatch names its grants
detail: `escapeHatch` on write and query handlers, hooks and jobs requires `grants`, a non-empty list of `systemIdentity`, `globalWrites`, `unsafeRaw` and `crossTenantReads`. A declaration without `grants` used to unlock all four; it now fails at boot with "grants is required". `defineProjectionQueryHandler` with `unsafeAllTenants: { reason }` declares `grants: ["systemIdentity"]`. An `escapeHatch` in `r.applyExtension` options takes `{ reason }` only and always means `unsafeRaw`; `grants` there fails at boot.
migration: Run the codemod. It adds the grants it can read from the definition (`unsafeRaw(` for unsafeRaw, `.global(` for globalWrites, `crossTenantReads` for crossTenantReads, `queryAs(`, `writeAs(`, `createSystemUser(`, `unsafeAllTenants` or `runAs` with SystemAdmin for systemIdentity) and lists every other declaration as manual. Add grants to the manual sites by hand and run the integration tests of the touched features: a missing grant only fails when that code path runs. Remove `grants` from `escapeHatch` in `r.applyExtension` options.
codemod: scripts/codemod/escape-hatch-grants.ts
manualAfterCodemod: true
-->
