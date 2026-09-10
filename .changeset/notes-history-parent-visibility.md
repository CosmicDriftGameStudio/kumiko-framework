---
"@cosmicdrift/kumiko-bundled-features": patch
---

Close a note-history write-path gap (fw#2627): add-note previously trusted entityType/entityId straight from the client, so any dispatch-eligible tenant user could attach a note to a parent object they had no read access to. `createNotesHistoryFeature` gains an opt-in `parents` option — an allowlist of entity names allowed as a note's parent — which, when set, also verifies the target row is visible through that entity's own read path (tenant scope plus its `access.read` ownership) before accepting the write.

This is additive and opt-in: without `parents`, add-note keeps accepting any entityType/entityId unchecked, exactly as before.
