---
"@cosmicdrift/kumiko-bundled-features": patch
---

The audit feature records read accesses: `recordAccess(ctx, entry)` writes to the new `store_access_log` table outside the caller's transaction, `audit:query:access-log` lists them for admins, and the maintenance job `audit:job:access-log-retention` prunes them per the tenant's compliance profile.

<!-- kumiko-changes
feature: audit
type: improvement
title: Access log for read accesses with compliance-profile retention
detail: Features that must prove who opened or used an object (a portal link, a shared document) call `recordAccess(ctx, { subjectType, subjectId, action, details })` from `@cosmicdrift/kumiko-bundled-features/audit` instead of appending an event to a fresh stream per access. The row lands in `store_access_log` through the outside-transaction connection, so query handlers can record too and a handler that fails afterwards still leaves the entry. Rows carry ids and codes only (details: up to 20 string, number or boolean values), never personal data. Admins of the tenant read them newest-first with cursor paging through `audit:query:access-log`, filtered by subject type, subject id, actor or action. The per-tenant maintenance job `audit:job:access-log-retention` deletes rows older than the compliance profile's audit-log retention (an override can only lengthen it; without compliance-profiles the minimal profile's 3 months apply), and tenant-lifecycle deletes a destroyed tenant's rows. Apps that mount audit need a schema migration for the new table.
migration: Apps that mount audit run `kumiko-schema generate` and ship the migration that creates `store_access_log`.
-->
