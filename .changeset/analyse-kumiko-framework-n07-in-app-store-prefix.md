---
"@cosmicdrift/kumiko-bundled-features": minor
---

`channel-in-app` stores its messages in `store_in_app_messages` instead of `in_app_messages`.

<!-- kumiko-changes
feature: channel-in-app
type: breaking
title: In-app messages table renamed to store_in_app_messages
detail: The direct-write table of `channel-in-app` follows the `store_` convention of the other unmanaged stores. The table is now `store_in_app_messages`, its indexes are `store_in_app_messages_tenant_user_created_idx` and `store_in_app_messages_idempotency_key_idx`. Columns, the `inAppMessagesTable` export and every query stay the same.
migration: `kumiko schema generate` sees a dropped and a new table and would lose the stored messages and their idempotency keys. Replace the generated DROP and CREATE for the two tables by hand with `ALTER TABLE "in_app_messages" RENAME TO "store_in_app_messages";`, `ALTER INDEX "in_app_messages_tenant_user_created_idx" RENAME TO "store_in_app_messages_tenant_user_created_idx";` and `ALTER INDEX "in_app_messages_idempotency_key_idx" RENAME TO "store_in_app_messages_idempotency_key_idx";`. Row-level-security policies move with the table.
-->
