---
"@cosmicdrift/kumiko-framework": patch
---

Migration scan for retired framework tables understands more DROP/RENAME forms

<!-- kumiko-changes
feature: framework
type: fix
title: Retired-table scan handles DROP TABLE lists, schema-qualified names and RENAME
detail: The scan of prior migrations for retired framework tables now marks every table in a DROP TABLE comma list as dropped, ignores a schema prefix such as "public"."table", and treats ALTER TABLE ... RENAME TO as dropping the old and creating the new name.
-->
