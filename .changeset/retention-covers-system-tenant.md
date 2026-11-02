---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The nightly retention cleanup now also runs for data in the system tenant. Per-tenant jobs only fanned out over active tenant rows, and the system tenant has none, so helpdesk requests and replies were never deleted after their 365 days and their attachments stayed in storage. The orphaned-upload sweep and the soft-delete cleanup had the same gap for system-tenant files.

<!-- kumiko-changes
feature: data-retention
type: fix
title: Retention cleanup, upload sweep and soft-delete cleanup reach the system tenant
detail: Jobs with `perTenant: true` can set `includeSystemTenant: true` to get one more run with `SYSTEM_TENANT_ID` after the active tenants (no duplicate if the app's `getActiveTenantIds` already returns it). `data-retention:job:retention-cleanup`, `files:job:sweep-orphaned-uploads` and `soft-delete:job:cleanup` set it, so helpdesk requests, replies and their attachments are deleted after `keepFor`. The retention run applies to every entity with a `retention` rule whose rows sit in the system tenant (for example download attempts or custom-field values written in a SystemAdmin session); they now expire after their declared `keepFor` like in any other tenant. Other per-tenant jobs (tenant inactivity, billing, workflows, reindex, inbound-mail retention) keep running for active tenants only. The soft-delete cleanup computes its grace cutoff from the job clock instead of the wall clock. Setting `includeSystemTenant` without `perTenant` fails at boot.
-->
