---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2766: join-row entities declare their carrier once, and both paths gate on it. `EntityDefinition.parentRef` (`{ entityTypeField, entityIdField, allowedTypes? }`) says "rows of this entity hang off a host row named by these two fields". The write handlers and the read path now derive one visibility rule from that single declaration instead of mechanising it twice: a caller may see or touch a join row only if the host row is visible through the host entity's own read path (tenant scope, soft-delete, `access.read` ownership). `note-entry`, `tag-assignment` and `folder-assignment` declare it; the `tag` catalog stays tenant-wide by design.

The read gate is an `EXISTS` sub-select spliced into the `WHERE` clause, not a post-filter over the fetched page — so it runs before `LIMIT`/`OFFSET` and `rows`, `nextCursor` and `total` all stay honest, including on the `tag-assignment` scatter query that filters on `tagId` across many different host types. One query per page, no N+1. Filtering on the entityType field (`eq` or `in`) narrows the gate to those hosts, which is why the bundled tag widgets now send `entityType` server-side instead of discarding foreign rows after the fetch.

**BREAKING**

1. `note-entry:list`, `tag-assignment:list` and `folder-assignment:list` are fail-closed by default. A caller who cannot see the host row no longer receives the join row — previously the only lever was `createNotesHistoryFeature({ ownership })` / `createTagsFeature({ ownership })`, and `folders` had no lever at all. Mounts that relied on tenant-wide reads of these lists will see fewer rows.

2. Rows whose `entityType` names no registered entity disappear from those lists (default-deny, matching what the write path has rejected since #2721/#2745). Audit before upgrading:

   ```sql
   SELECT entity_type, count(*) FROM read_tag_assignments GROUP BY 1;
   SELECT entity_type, count(*) FROM read_note_entries GROUP BY 1;
   SELECT entity_type, count(*) FROM read_folder_assignments GROUP BY 1;
   ```

   Any `entity_type` in the result that is not a registered entity name becomes invisible.

3. Join rows on a soft-deleted host are no longer listed. This mirrors the write path, which has always resolved the host through `executor.detail` (soft-deletes filtered). `includeDeleted: true` lifts it for trash views.

4. A hand-written `<entity>:list` / `<entity>:detail` query handler on a `parentRef` entity now fails boot validation until it either uses `defineEntityListHandler` / `defineEntityDetailHandler` or passes `parentVisibility` to the executor itself. The gate needs the registry, which only exists at request time; enforcing this at boot keeps the raw executor usable for framework-internal cascade and GDPR paths without turning a missed wiring into a silent leak. A query handler under a *different* name that calls `executor.list` on a `parentRef` entity is not detectable this way and stays ungated — pass `parentVisibility` there yourself.

5. Listing a join-row entity now reads the host tables it might match against, so every registered entity that is an admissible host must actually have its table. Migrations provision all of them, so a migrated deployment is fine; hand-rolled test stacks that create only some tables will need the rest. Narrow the set with `parents` (`allowedTypes`) — it is also the lever that keeps the generated SQL and its query plan small.

Also fixed: the `totalCount` fast path on the search path returned `filterIds.length` even when the `WHERE` had been narrowed further by ownership, field-read rules, screen filters or soft-delete, so `total` could overcount. It now only applies when the search-id clause is the whole `WHERE`.

`ownership` keeps a distinct job and is no longer the mechanism for host visibility: `ownership.read` is an *additional* row rule on the join row itself (for example author-only notes) and is AND-ed with the host gate. `ownership.write` is unchanged. New: `createFoldersFeature({ ownership, parents })` — folders had neither — and `createTagsFeature({ parents })`. `createNotesHistoryFeature({ parents })` now narrows the read path too, not just `add-note`.
