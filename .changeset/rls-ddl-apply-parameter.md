---
"@cosmicdrift/kumiko-framework": patch
---

Row level security DDL behind a `rowLevelSecurity` parameter, and projection rebuilds keep RLS on the table.

<!-- kumiko-changes
feature: framework
type: improvement
title: Row level security policy DDL behind a rowLevelSecurity parameter
detail: renderTableDdl, renderTablesDdl and unsafePushTables accept rowLevelSecurity "off" or "on" (default "off", output unchanged). With "on", every table that has a tenant_id column gets ENABLE and FORCE ROW LEVEL SECURITY plus the policies kumiko_tenant_isolation and kumiko_system_tenant_read, driven by the kumiko.tenant_id and kumiko.scope settings. Tables without tenant_id are left alone.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: The migration generator writes a row level security section
detail: With rowLevelSecurity "on", generateMigration adds a Row level security section for new, changed and recreated tables and a rowLevelSecurity field to the snapshot; switching back to "off" emits the matching DISABLE statements with a warning. Without the option the generated SQL and snapshot are byte-identical to before.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Migration replay understands CREATE, ALTER and DROP POLICY
detail: The replay behind kumiko-schema validate tracks ENABLE and FORCE ROW LEVEL SECURITY and policy names per table, follows table renames, and reports row-level-security-drift when the committed SQL does not produce the policies the snapshot expects. An unparsable policy statement fails loudly.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Projection and multi-stream rebuilds no longer abort on tables with row level security
detail: The shadow swap used to refuse a live table with RLS flags or policies. It now reads them from the catalog under the swap lock, re-applies them to the swapped-in table and fails the rebuild transaction if the result differs.
-->
