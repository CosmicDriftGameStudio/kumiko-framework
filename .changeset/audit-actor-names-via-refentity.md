---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Audit log shows actor display names instead of raw UUIDs (fw#3103)

The `Actor` column of `audit:screen:audit-log` and the `createdBy` field of its detail screen rendered the raw `createdBy` UUID. The framework primitive for this already existed — `ListColumnSpec.refEntity` / `refLabelField`, used by `sessions` and `delivery` — the audit feature just did not declare it. Both now carry `refEntity: "user:user"`, `refLabelField: "displayName"`, which also makes the `createdBy → user:user` relation machine-readable in the app schema instead of implicit.

`audit:query:list` and `audit:query:details` are unchanged and still return the plain id.

A system write (`SYSTEM_USER_ID`, the null UUID) has no `read_users` row, so the bulk reference lookup can never resolve it. `SYSTEM_REFERENCE_LABELS` gained a `user:user` entry with the new `kumiko.reference.system-user` key, so every screen referencing `user:user` — not just the audit log — renders "System" for it. An actor that resolves to no row at all (deleted user) keeps the existing generic fallback: the raw id, no throw.

`SYSTEM_USER_ID` moved from `framework/engine/system-user` to `kumiko-types/identifiers`, next to `SYSTEM_TENANT_ID`, so the client-side reference-label map can read it without importing a runtime module. `engine/system-user` re-exports it — every existing import keeps working.

<!-- kumiko-changes
feature: audit
type: improvement
title: Audit log shows actor display names instead of raw UUIDs (fw#3103)
migration: The audit feature now declares `r.requires("tenant", "user")`. An app that mounts `createAuditFeature()` without the `user` feature fails at boot with `Feature "audit" requires feature "user" which is not registered` — mount `createUserFeature()`. Apps using `securityBaselineFeatures()` already had to mount it.
-->
