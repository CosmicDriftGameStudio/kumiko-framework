// notes-history — generic, host-agnostic, append-only note history for ANY
// entity. Replaces a single overwritable textarea (e.g. solon's
// contact.notes) with multiple timestamped, authored entries — who wrote
// what, when, is reconstructable instead of lost on the next overwrite.
//
// Event-sourced, not relational, same pattern as tags/tag-assignment: the
// feature owns one entity, `note-entry` (read_note_entries), keyed by
// (entityType, entityId) — no column on the host entity, no JOIN. Unlike
// tags there is no deterministic aggregate-id: many notes may exist per
// entity, so every create() is an ordinary random-id stream.
//
// Only create + list are registered — no update, no delete. A correction is
// a new entry, not an edit; see entity.ts for why that still satisfies GDPR
// erasure without a delete path.

import {
  type AccessRule,
  defineEntityListHandler,
  defineFeature,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_NOTES_HISTORY_ACCESS, NOTES_HISTORY_FEATURE_NAME } from "./constants";
import { noteEntryEntity } from "./entity";
import { createAddNoteHandler } from "./handlers/add-note.write";
import { NOTES_HISTORY_FEATURE_I18N } from "./i18n";

function registerNotesHistory(
  r: FeatureRegistrar<typeof NOTES_HISTORY_FEATURE_NAME>,
  access: AccessRule,
): void {
  r.describe(
    "Generic, host-agnostic, append-only note history for any entity. Owns one event-sourced entity, `note-entry` (`read_note_entries`), keyed by (entityType, entityId) — so attaching notes adds NO column to the host entity and needs no relational pivot or JOIN. Provides a `create` write-handler (author stamped server-side from the caller, never client-supplied) and a `list` query filterable on entityId. Deliberately append-only: no update or delete handler is registered — a correction is a new entry, not an edit, so who-said-what-when stays reconstructable. Every path uses one access rule — adopt the host's model with createNotesHistoryFeature({ access: { openToAll: true } }) or pin roles with createNotesHistoryFeature({ roles }).",
  );
  r.uiHints({
    displayLabel: "Notes",
    category: "data",
    recommended: false,
  });

  r.entity("note-entry", noteEntryEntity);

  r.writeHandler(createAddNoteHandler(access));
  r.queryHandler(defineEntityListHandler("note-entry", noteEntryEntity, { access }));

  r.translations({ keys: NOTES_HISTORY_FEATURE_I18N });
}

export const notesHistoryFeature = defineFeature(NOTES_HISTORY_FEATURE_NAME, (r) =>
  registerNotesHistory(r, DEFAULT_NOTES_HISTORY_ACCESS),
);

export type NotesHistoryFeatureOptions = {
  /** Access rule for the create/list paths. Default { roles: ["TenantAdmin","TenantMember"] }.
   *  Adopt the host's model — e.g. { openToAll: true } when the host lets any
   *  authenticated tenant user write (like the rest of its handlers), or
   *  { roles: ["Admin"] } for a custom role vocabulary. Takes precedence over `roles`. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Ignored when `access` is set. */
  readonly roles?: readonly string[];
};

function resolveAccess(opts: NotesHistoryFeatureOptions): AccessRule {
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return DEFAULT_NOTES_HISTORY_ACCESS;
}

// Options wrapper. Without options returns the module-level singleton (no
// rebuild). access/roles build a fresh feature-definition.
export function createNotesHistoryFeature(
  opts: NotesHistoryFeatureOptions = {},
): typeof notesHistoryFeature {
  if (opts.access === undefined && opts.roles === undefined) return notesHistoryFeature;
  return defineFeature(NOTES_HISTORY_FEATURE_NAME, (r) =>
    registerNotesHistory(r, resolveAccess(opts)),
  );
}
