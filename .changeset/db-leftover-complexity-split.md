---
"@cosmicdrift/kumiko-framework": patch
---

The field-to-column mapping, the entity index set and the migration SQL rendering are split into smaller steps without changing any generated table or migration.

<!-- kumiko-changes
feature: framework
type: improvement
title: Table and migration generation split into smaller steps
detail: fieldToColumnMeta, buildEntityTable and renderMigrationSql are now tables and named steps instead of long functions. Columns, indexes and migration SQL are byte-identical; nothing changes for apps.
-->
