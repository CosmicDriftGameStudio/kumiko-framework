---
"@cosmicdrift/kumiko-framework": patch
---

Review fixes for the db layer: RLS policy drops ahead of tenant_id changes, sortNulls boot rule, one money derived subquery.

<!-- kumiko-changes
feature: framework
type: fix
title: db layer review fixes (migration RLS ordering, sortNulls rule, derived money)
detail: A generated migration now drops the previous row level security policies before an in-place `tenant_id` type change or drop, so Postgres no longer rejects the ALTER with a policy dependency (new section "Row level security (pre)"). The boot validator rejects `sortNulls` on a field without `sortable: true` (rule `entity/sort-nulls-needs-sortable`). A money derived field reads amount and currency in one jsonb_build_array subquery instead of two correlated subqueries per row. The unknown-field-type error names the type, reference sorts reuse the cached target table of the search path, `extractTableInfo` takes `unknown` (no more query.ts import cycle), and stale comments and a hand-rolled IN placeholder loop are fixed.
-->
