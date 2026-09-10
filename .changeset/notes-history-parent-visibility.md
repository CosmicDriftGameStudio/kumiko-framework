---
"@cosmicdrift/kumiko-bundled-features": minor
---

Close a note-history write-path gap (fw#2627): add-note previously trusted entityType/entityId straight from the client, so any dispatch-eligible tenant user could attach a note to a parent object they had no read access to. add-note now unconditionally verifies that entityType names a registered entity and that the row is visible to the caller through that entity's own read path (tenant scope plus its `access.read` ownership) before accepting the write; either check failing returns a not_found response, same as a genuinely missing row. `createNotesHistoryFeature` also gains a `parents` option — an allowlist further narrowing which registered entities may be a note's parent — but it is additive-only, not what turns the check on.

**Migration:** entityType must now name an entity registered in the mounting app. Any existing add-note caller that used an entityType with no matching registered entity, or targeted a row the caller couldn't otherwise read, will start getting not_found instead of a successful write. Register the parent entity (with an `access.read` ownership rule if it needs row-level scoping) before upgrading.
