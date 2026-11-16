---
"@cosmicdrift/kumiko-bundled-features": patch
---

Sessions and personal access tokens gained a `userId` index that apps must ship as a migration.

<!-- kumiko-changes
feature: sessions
type: improvement
title: userId indexes on store_user_sessions and store_api_tokens
detail: The device list, logout everywhere, password-change mass revoke and the token list filter both tables by `userId`, but only `tenant_id` and the token hash were indexed, so these reads scanned all sessions or tokens of a tenant, and the cross-tenant revokes scanned the whole table. Both tables now declare an index on `userId` (`store_user_sessions_user_id_idx`, `store_api_tokens_user_id_idx`). Existing databases only get them through a migration; the schema drift check covers tables and columns, not indexes. Apps that mount sessions or personal-access-tokens run `kumiko schema generate` and ship the resulting migration.
-->
