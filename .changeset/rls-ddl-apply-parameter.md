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
detail: The replay behind kumiko-schema validate tracks ENABLE and FORCE ROW LEVEL SECURITY and policy definitions per table, follows table renames, and reports row-level-security-drift when the committed SQL does not produce the policies the snapshot expects (missing, extra, altered or hand-edited) or turns on row level security for a table the snapshot has no spec for. An unparsable policy statement, or a policy or row level security change inside a DO block, fails loudly.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Projection and multi-stream rebuilds no longer abort on tables with row level security
detail: The shadow swap used to refuse a live table with RLS flags or policies. It now reads them from the catalog under the swap lock, re-applies them to the swapped-in table and fails the rebuild transaction if the result differs. Before the first read, the rebuild checks that the table's policies let its system scope see every row, so the guards never see too few rows and the swap never drops hidden ones.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Migration replay parses ALTER TABLE ONLY, IF EXISTS and public. prefixes
detail: kumiko-schema validate read `ALTER TABLE ONLY "t"` as a change to a table named ONLY and ignored IF EXISTS and a public. prefix; the statement now applies to the named table.
-->
