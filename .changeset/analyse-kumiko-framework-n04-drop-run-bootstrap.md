---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

`runBootstrap` is removed; `seeds.bootstrapAdminFromEnv` is the only first-run path.

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: runBootstrap removed; seeds.bootstrapAdminFromEnv is the first-run path
detail: `runBootstrap` provisioned tenants and mailed invitations from a one-shot job. No app used it, and it was a second first-run mechanism next to `seeds.bootstrapAdminFromEnv`. `runBootstrap`, `RunBootstrapOptions` and the `deliverQueuedInline` option of `buildBootExtraContext` are removed.
migration: Provision the first admin with `seeds.bootstrapAdminFromEnv` and `KUMIKO_BOOTSTRAP_ADMIN_EMAIL`, with password reset wired (docs/guides/prod-bootstrap.md). Set system-only per-tenant config such as `auth-mfa:config:required` from a `seeds.run` function as a system write.
-->

The auth-email-password feature drops the bootstrap plan and global roles on invitations.

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: bootstrapTenants removed; system-invite-create no longer carries global roles
detail: Removed exports: `bootstrapTenants`, `BootstrapPlanError`, `BootstrapWriteError`, `BootstrapConfigValue`, `BootstrapDeps`, `BootstrapInvite`, `BootstrapInviteOutcome`, `BootstrapPlan`, `BootstrapReport`, `BootstrapSeedDeps`, `BootstrapSystemAdmin`, `BootstrapTenant`, `BootstrapTenantOutcome`. `system-invite-create` no longer accepts `globalRoles`, and the result of `invite-create` and `system-invite-create` no longer contains `globalRoles`. Accepting an invitation grants only the membership role; the session keeps the global roles the user already holds.
migration: Drop `globalRoles` from `system-invite-create` payloads. Grant a global role through the user feature instead of an invitation.
-->

The tenant feature drops the globalRoles field of invitations.

<!-- kumiko-changes
feature: tenant
type: breaking
title: Invitation field globalRoles removed
detail: The `globalRoles` field of `tenant-invitation` (column `read_tenant_invitations.global_roles`) is removed, and `tenant:query:invitations` no longer returns it to a SystemAdmin. Stored invitation events that carry the field still replay; the field is ignored.
migration: Generate and apply a migration that drops `read_tenant_invitations.global_roles` (`kumiko schema generate`).
-->

The delivery feature drops the inline option of its notify factory.

<!-- kumiko-changes
feature: delivery
type: breaking
title: createDeliveryNotifyFactory no longer takes deliverQueuedInline
detail: The option only served the removed one-shot `runBootstrap` process. `createDeliveryNotifyFactory(deliveryService)` always hands the calling context's job dispatcher to `notify()`.
migration: Remove the second argument from `createDeliveryNotifyFactory` calls.
-->

The dev-server no longer bundles bin/bootstrap.ts on its own.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: buildServerBundle no longer picks up bin/bootstrap.ts
detail: `bin/bootstrap.ts` next to `bin/main.ts` was built to `dist-server/bootstrap.js` for `runBootstrap`. Only `bin/worker.ts` is still picked up as a sibling entry; `bootstrap.js` is no longer a reserved output name.
migration: Pass a one-shot script explicitly with `kumiko-build --entry bin/<name>.ts` or `buildServerBundle({ extraEntries })`.
-->
