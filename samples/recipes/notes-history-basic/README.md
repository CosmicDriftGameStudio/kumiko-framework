# Notes History

Attach an append-only note history to **any** entity — without adding a
column to it, writing a migration, or touching its feature. The recipe
creates a plain `task` entity that knows nothing about notes, then notes
tasks through the `notes-history` bundle alone.

The result: a task can carry any number of notes, each with an author and
timestamp, in the order they were written — and the `task` row stays exactly
`{ id, title }`.

## What it shows

- **Zero host changes** — `task` has no notes column, no notes-specific
  wiring, no awareness of notes at all. Note-taking works anyway, because
  the notes-history feature owns its own table.
- **`notes-history:write:add-note`** — appends a `note-entry`
  (`read_note_entries`) keyed by `{ entityType, entityId, body }`. The author
  is never client-supplied: the write always attributes to the authenticated
  caller, and `insertedAt` (a framework base column) is the timestamp.
- **Strictly append-only** — there is no update or delete handler. A
  correction is a new entry, not an edit, so who wrote what and when stays
  reconstructable — the entire reason this bundle exists (a single
  overwritable textarea can't do that).
- **Read-layer composition, no JOIN** — "this task's note history" lists
  `note-entry` filtered by `entityId`, sorted by `insertedAt`. The app reads
  and sorts; there is no relational pivot.

## Using it — the notes flow

You use the bundle by dispatching its handlers; nothing is wired into the
noted entity. A host needs just two calls — `write` and `query` — which any
app dispatcher provides. The flow below is embedded from `usage.ts` and is
run end-to-end against the real dispatcher + DB by this recipe's integration
test (`the documented notesFlow appends two notes, newest first`):

```ts file=<rootDir>/_samples/recipes-notes-history-basic/src/usage.ts
```

## Web UI — the drop-in `<NotesSection>`

You don't have to hand-build a notes UI. The feature ships one from its
client subpath `@cosmicdrift/kumiko-bundled-features/notes-history/web`:
`<NotesSection>` takes an `entityName` + `entityId`, shows that entity's note
history newest-first, and lets the user append a new one — calling the same
handler as above. Register `notesHistoryClient()` once (for its component +
i18n), then mount it either way:

```tsx illustration
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { notesHistoryClient, NotesSection, NOTES_SECTION_EXTENSION_NAME } from "@cosmicdrift/kumiko-bundled-features/notes-history/web";

// once, at app boot — required even for standalone use (registers i18n):
createKumikoApp({ clientFeatures: [notesHistoryClient()] });

// standalone — drop it into any screen, no entityEdit screen needed:
<NotesSection entityName="task" entityId={taskId} />

// or as an extension section in an entityEdit screen schema:
{ kind: "extension", title: "Notes", component: { react: { __component: NOTES_SECTION_EXTENSION_NAME } } }
```

The component itself is `notes-history/web/notes-section.tsx`
([source](https://github.com/CosmicDriftGameStudio/kumiko-framework/blob/main/packages/bundled-features/src/notes-history/web/notes-section.tsx)).

## Feature composition

```
notes-history    → core bundle: note-entry entity, add-note handler, list query
task-management  → our feature: a plain `task` entity. Declares
                   r.requires("notes-history") only so the bundle is
                   mounted — the task itself is completely notes-agnostic.
```

## Why it's event-sourced, not a pivot table

Kumiko is event-sourced: there are no relational pivots queried by JOIN. The
`note-entry` entity is a feature-owned, event-sourced row keyed by
`(entityType, entityId)`, and the framework projects it into
`read_note_entries` from its own create events. Unlike a join-table pattern
with a deterministic id (see the `tags` bundle), there is no dedup key here —
an entity legitimately carries many notes, so every `add-note` is an ordinary
random-id stream. Cross-entity reads (a task's note history) are assembled by
reading that projection and filtering in the app — never by joining across
aggregates.

## Run

```bash
bun test src/__tests__/feature.integration.test.ts
```
