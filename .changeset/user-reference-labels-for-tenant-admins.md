---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

User reference columns show display names for TenantAdmins, not only SystemAdmins (fw#3107)

Every `user:user` reference (the audit-log actor, the sessions user column, their detail screens) resolved its label through the entity-convention query `user:query:user:list`. That handler is the SystemAdmin cross-tenant user roster, so a TenantAdmin got a 403 and every cell fell back to the raw UUID — in practice every tenant admin reading their own audit log.

The roster stays SystemAdmin-only: its `tenants` column joins every membership of a user and would expose foreign tenant names. Instead the new `tenant:query:member-directory` (`access.admin`) returns just `{ id, label }` pairs — the display name, no email, no roles. An admin gets their own tenant's members; a SystemAdmin keeps the global reach the roster gave them, so operator actions in tenants they are no member of still resolve. The query is not exposed to agents. The new central `REFERENCE_LOOKUP_SOURCES` map in `@cosmicdrift/kumiko-framework/ui-types` routes `user:user` lookups there, the same way `SYSTEM_REFERENCE_LABELS` already applies per referenced entity. The list lookup, the read-only detail value, the reference combobox and embedded-list reference cells all consult it; a reference field's own `optionsQuery` still wins.

<!-- kumiko-changes
feature: tenant
type: improvement
title: User reference columns show display names for TenantAdmins (fw#3107)
migration: No code change needed. Two behavior shifts to be aware of: for a non-SystemAdmin, a `user:user` reference picker in an edit form now offers the active tenant's members (it used to fail with a 403 and stay empty) — set `optionsQuery` on the reference field if a screen needs a different source. And a `user:user` label now only resolves when the `tenant` feature is mounted. In an app that mounts `sessions` without `tenant`, a SystemAdmin — who used to see names there — now sees the raw id, the same fallback a TenantAdmin got before; mount `createTenantFeature()` to get names back.
-->
