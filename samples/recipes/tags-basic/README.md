# Tags

Tag and group **any** entity — without adding a column to it, writing a
migration, or touching its feature. The recipe creates a plain `note`
entity that knows nothing about tags, then tags and groups notes through
the `tags` bundle alone.

The result: a note can carry any number of tags, you can ask "which tags
does this note have?" and "which notes carry this tag?", and the `note`
row stays exactly `{ id, title }`.

## What it shows

- **Zero host changes** — `note` has no tag column, no `wireTagsFor`, no
  tag awareness. Tagging works anyway, because the tags feature owns its
  own tables.
- **`tags:write:create-tag`** — adds a tag to the tenant's catalog
  (`read_tags`). Returns the tag's id.
- **`tags:write:assign-tag` / `remove-tag`** — link/unlink a tag and an
  entity by `{ tagId, entityType, entityId }`. Both are idempotent:
  re-assigning is a no-op, removing a non-existent link still succeeds.
- **Read-layer composition, no JOIN** — "tags of a note" lists
  `tag-assignment` filtered by `entityId`; "notes with a tag" filters by
  `tagId`. The app composes the two reads; there is no relational pivot.

## Using it — the tag flow

You use the bundle by dispatching its handlers; nothing is wired into the
tagged entity. `dispatch`/`query` below is your app's client (or a test
harness) — every call is exercised by this recipe's integration test.

```ts illustration
// 1. Create a tag in the tenant catalog → returns its id
const { id: tagId } = await dispatch("tags:write:create-tag", { name: "important" })

// 2. Attach it to ANY entity by (type, id) — no column on that entity
await dispatch("tags:write:assign-tag", { tagId, entityType: "note", entityId: noteId })

// 3a. "Which tags does this note have?" — filter assignments by entityId
const { rows: ofNote } = await query("tags:query:tag-assignment:list", {
  filter: { field: "entityId", op: "eq", value: noteId },
}) // ofNote[].tagId

// 3b. "Which notes carry this tag?" — filter by tagId (no JOIN)
const { rows: withTag } = await query("tags:query:tag-assignment:list", {
  filter: { field: "tagId", op: "eq", value: tagId },
}) // withTag[].entityId

// 4. Detach it again (idempotent — removing a missing link still succeeds)
await dispatch("tags:write:remove-tag", { tagId, entityType: "note", entityId: noteId })
```

## Feature composition

```
tags             → core bundle: tag + tag-assignment entities,
                   create/assign/remove handlers, list queries
note-management  → our feature: a plain `note` entity. Declares
                   r.requires("tags") only so the bundle is mounted —
                   the note itself is completely tag-agnostic.
```

## Why it's event-sourced, not a pivot table

Kumiko is event-sourced: there are no relational pivots queried by JOIN.
The `tag-assignment` entity is a feature-owned, event-sourced join row
keyed by `(entityType, entityId)`, and the framework projects it into
`read_tag_assignments` from its own events. A deterministic aggregate-id
per `(tenant, tag, entity)` makes assigning idempotent. Cross-entity
views (a note's tags, a tag's notes) are assembled by reading that
projection and composing in the app — never by joining across aggregates.

## Run

```bash
bun test src/__tests__/feature.integration.test.ts
```
