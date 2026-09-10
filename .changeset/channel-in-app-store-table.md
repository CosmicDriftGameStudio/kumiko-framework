---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix `channel-in-app` never registering its `in_app_messages` table via `r.storeTable()`. The table was declared as a plain `pgTable` but never showed up in `collectTableMetas()`, so no migration was ever generated for it — any app using the feature hit `relation "in_app_messages" does not exist` on the first read/write to the in-app inbox. Added `inAppMessagesTableMeta`, derived from the existing `inAppMessagesTable` so the two cannot drift, and registered it with `r.storeTable(...)` in `createChannelInAppFeature`. No schema/data-model change — this only makes the migration generator aware of a table that already existed in code.
