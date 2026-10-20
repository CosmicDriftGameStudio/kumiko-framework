---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

SystemAdmin audit log across all tenants

<!-- kumiko-changes
feature: audit
type: improvement
title: SystemAdmin audit log across all tenants
detail: New queries audit:query:list-all-tenants and audit:query:details-all-tenants (SystemAdmin only) return the audit trail of every tenant, each row with its tenantId, filterable by tenant. Screens audit-log-all-tenants and audit-log-all-tenants-detail show the tenant name; the admin-shell platform workspace lists the new nav audit:nav:audit-log-all-tenants. Events of the system tenant are not included. The audit feature now declares r.systemScope(), so its handlers read through ctx.systemDb instead of ctx.db, and list and details rows carry tenantId too. A targetless cross-tenant read (acknowledgeCrossTenant or cross-tenant-read) is now recorded at most once per actor, handler, tenant and reason per hour, so the reference lookups of a SystemAdmin list no longer flood the trail on every page load; all other escape-hatch kinds keep the 60 s window. The audit events keep metadata free of PII ciphertext, a cursor or id beyond bigint is a 422 and the all-tenants tenant filter takes at most 100 ids. Applies to every user:user reference column and read-only reference field in all apps, not only the audit screens: an actor without a visible row no longer shows the raw id but reads "Unknown" (kumiko.reference.unknown-user), once the lookup finished without error (while it loads or after it failed the cell keeps a placeholder), and the "system" createdBy literal reads "System". The audit screen descriptions are now short user-facing sentences.
migration: Apps with their own platform workspace add the nav `audit:nav:audit-log-all-tenants` (screen `audit:screen:audit-log-all-tenants`) to its navs; apps using the admin-shell platform workspace get it automatically.
-->
