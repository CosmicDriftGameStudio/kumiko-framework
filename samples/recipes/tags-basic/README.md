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
tagged entity. A host needs just two calls — `write` and `query` — which any
app dispatcher provides. The flow below is embedded from `usage.ts` and is
run end-to-end against the real dispatcher + DB by this recipe's integration
test (`the documented tagFlow runs …`):

```ts file=<rootDir>/_samples/recipes-tags-basic/src/usage.ts
```

## Web UI — the drop-in `<TagSection>`

You don't have to hand-build a tag UI. The feature ships one from its client
subpath `@cosmicdrift/kumiko-bundled-features/tags/web`: `<TagSection>` takes an
`entityName` + `entityId`, shows that entity's tags, and lets the user attach an
existing tag, create-and-attach a new one, or detach — calling the same handlers
as above. Register `tagsClient()` once (for its component + i18n), then mount it
either way:

```tsx illustration
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { tagsClient, TagSection, TAGS_SECTION_EXTENSION_NAME } from "@cosmicdrift/kumiko-bundled-features/tags/web";

// once, at app boot — required even for standalone use (registers i18n):
createKumikoApp({ clientFeatures: [tagsClient()] });

// standalone — drop it into any screen, no entityEdit screen needed:
<TagSection entityName="note" entityId={noteId} />

// or as an extension section in an entityEdit screen schema:
{ kind: "extension", title: "Tags", component: { react: { __component: TAGS_SECTION_EXTENSION_NAME } } }
```

The component itself is `tags/web/tag-section.tsx`
([source](https://github.com/CosmicDriftGameStudio/kumiko-framework/blob/main/packages/bundled-features/src/tags/web/tag-section.tsx))
and is covered by a unit test that asserts the exact handlers it dispatches.

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
