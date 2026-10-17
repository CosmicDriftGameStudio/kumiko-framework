---
"@cosmicdrift/kumiko-framework": patch
---

collectTableMetas rejects two features registering the same table name

<!-- kumiko-changes
feature: framework
type: fix
title: collectTableMetas rejects two features registering the same table name
detail: Two entities or storeTables with the same table name produced duplicate metas that only failed later in `schema generate` with a message about a hand-added meta. collectTableMetas now throws at the first registration with both origins, so setupTestStack fails the same way. The duplicate-name error of the migration generator no longer assumes a hand-added meta.
-->
