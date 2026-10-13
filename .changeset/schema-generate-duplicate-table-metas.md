---
"@cosmicdrift/kumiko-framework": patch
---

kumiko-schema generate and validate now reject ENTITY_METAS that list a table twice. Before, the migration silently diffed only the last definition, so a new index landed in the snapshot without any CREATE INDEX SQL.

<!-- kumiko-changes
feature: framework
type: breaking
title: Schema generate rejects a table listed twice in ENTITY_METAS
detail: When ENTITY_METAS contained the same tableName twice, the migration diff kept only the last definition and compared it against the previous snapshot entry, so a new index was written to .snapshot.json but no CREATE INDEX reached the migration SQL. kumiko-schema generate, kumiko-schema validate and programmatic generateMigration now throw (generate and validate exit 1 with a message naming every duplicated table) before any file is written.
migration: Remove hand-added metas for tables a feature already registers from kumiko/schema.ts. Known: phronexsis kumiko/schema.ts appends IN_APP_MESSAGES_META next to collectTableMetas(FEATURES); drop it (and its comment), then run kumiko-schema generate — the existing in_app_messages_tenant_user_created_idx comes out as CREATE INDEX IF NOT EXISTS (no-op) and the two legacy indexes as commented review drops. The duplicate in_app_messages entry in .snapshot.json disappears with that generate.
-->
