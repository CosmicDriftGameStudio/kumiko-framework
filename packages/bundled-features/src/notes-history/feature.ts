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
  type EntityDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { hasWhereRule } from "../shared";
import { DEFAULT_NOTES_HISTORY_ACCESS, NOTES_HISTORY_FEATURE_NAME } from "./constants";
import { createNoteEntryEntity, noteMentionEntity } from "./entity";
import { createAddNoteHandler } from "./handlers/add-note.write";
import { NOTES_HISTORY_FEATURE_I18N } from "./i18n";

function registerNotesHistory(
  r: FeatureRegistrar<typeof NOTES_HISTORY_FEATURE_NAME>,
  access: AccessRule,
  ownership: EntityDefinition["access"] | undefined,
  parents: readonly string[] | undefined,
): void {
  r.describe(
    "Generic, host-agnostic, append-only note history for any entity. Owns one event-sourced entity, `note-entry` (`read_note_entries`), keyed by (entityType, entityId) — so attaching notes adds NO column to the host entity and needs no relational pivot or JOIN. Provides a `create` write-handler (author stamped server-side from the caller, never client-supplied) and a `list` query filterable on entityId. Deliberately append-only: no update or delete handler is registered — a correction is a new entry, not an edit, so who-said-what-when stays reconstructable. Every path uses one access rule — adopt the host's model with createNotesHistoryFeature({ access: { openToAll: true } }) or pin roles with createNotesHistoryFeature({ roles }).",
  );
  r.uiHints({
    displayLabel: "Notes",
    category: "data",
    recommended: false,
  });

  const entity = createNoteEntryEntity(ownership, parents);
  r.entity("note-entry", entity);
  // No write/query handler of its own — populated only as a side effect of
  // add-note (see handlers/add-note.write.ts), looked up by
  // notes-history-user-data's forget cascade. Registering the entity (not
  // just building it inline in the handler) is what makes it visible to the
  // registry-wide GDPR boot guards and to executor.ts's table/projection setup.
  r.entity("note-mention", noteMentionEntity);

  r.writeHandler(createAddNoteHandler(access));
  r.queryHandler(
    defineEntityListHandler("note-entry", entity, {
      access,
      description:
        "Lists note-history entries of the caller's tenant with their text, author and timestamp; filter on entityId to read the full note trail of one record.",
    }),
  );

  r.translations({ keys: NOTES_HISTORY_FEATURE_I18N });
}

export const notesHistoryFeature = defineFeature(NOTES_HISTORY_FEATURE_NAME, (r) =>
  registerNotesHistory(r, DEFAULT_NOTES_HISTORY_ACCESS, undefined, undefined),
);

export type NotesHistoryFeatureOptions = {
  /** Access rule for the create/list paths. Default { roles: ["TenantAdmin","TenantMember"] }.
   *  Adopt the host's model — e.g. { openToAll: true } when the host lets any
   *  authenticated tenant user write (like the rest of its handlers), or
   *  { roles: ["Admin"] } for a custom role vocabulary. Takes precedence over `roles`. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Ignored when `access` is set. */
  readonly roles?: readonly string[];
  /** Row-level ownership on the note-entry rows themselves — orthogonal to
   *  `access`, which only gates whether a caller may dispatch create/list at
   *  all. `ownership.read` is no longer what keeps a caller from reading notes
   *  on host entities they can't see: that gate is default-on since fw#2766
   *  and derives from the entity's `parentRef`. Use `ownership.read` for an
   *  ADDITIONAL row rule on the note row itself (e.g. author-only visibility);
   *  it is AND-ed with the host-visibility gate, never a replacement for it.
   *
   *  `ownership.write` is separate and does NOT affect list/read. It's
   *  consulted by the framework's generic delete/forget/restore paths (not
   *  by this feature's own add-note handler — see createNotesHistoryFeature's
   *  boot-guard comment). A `from()` rule there also gates GDPR erasure
   *  (`forget`): if the rule's role map doesn't cover whatever role the
   *  erasure/retention pipeline runs as, `forget` denies instead of
   *  crypto-shredding — a silent Art.17 failure, not a thrown error. Make
   *  sure any `ownership.write` you set covers that role, or leave it unset. */
  readonly ownership?: EntityDefinition["access"];
  /** Allowlist further narrowing which registered entities may be used as a
   *  note's parent (entityType). This is NOT what turns parent-checking on —
   *  both paths always verify that entityType names a registered entity and
   *  that the row is visible to the caller through that entity's own read
   *  path (tenant scope plus its `access.read` ownership); an entityType
   *  that names no registered entity is rejected regardless of this option.
   *  Setting `parents` narrows further, to a specific set of entity names —
   *  useful when a host entity is registered but should never be a valid
   *  note parent. It also shrinks the read gate's SQL, which otherwise has to
   *  consider every registered entity as a candidate host. */
  readonly parents?: readonly string[];
};

function resolveAccess(opts: NotesHistoryFeatureOptions): AccessRule {
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return DEFAULT_NOTES_HISTORY_ACCESS;
}

// Options wrapper. Without options returns the module-level singleton (no
// rebuild). access/roles/ownership build a fresh feature-definition.
export function createNotesHistoryFeature(
  opts: NotesHistoryFeatureOptions = {},
): typeof notesHistoryFeature {
  if (
    opts.access === undefined &&
    opts.roles === undefined &&
    opts.ownership === undefined &&
    opts.parents === undefined
  ) {
    return notesHistoryFeature;
  }
  if (hasWhereRule(opts.ownership?.write)) {
    throw new Error(
      "createNotesHistoryFeature({ ownership }): ownership.write must not contain a " +
        '`{ kind: "where" }` rule — where-rules are evaluated only at the SQL ' +
        "layer (the read path, via buildOwnershipClause). Write paths that " +
        "consult access.write (userCanCreateFieldRow/userCanWriteFieldRow) can't " +
        "evaluate them, so such a rule can only ever deny — boot validation " +
        "rejects it too (fw#2626). Use a `from()` rule for ownership.write, or " +
        "leave it unset.",
    );
  }
  // A mount that accepts no parents at all can never take a note write —
  // that's a config mistake, not a valid allowlist. Omit `parents` instead
  // of passing an empty array.
  if (opts.parents !== undefined && opts.parents.length === 0) {
    throw new Error(
      "createNotesHistoryFeature({ parents }): parents must not be an empty array — " +
        "an empty allowlist rejects every add-note call. Omit `parents` to keep " +
        "today's unrestricted behavior instead.",
    );
  }
  return defineFeature(NOTES_HISTORY_FEATURE_NAME, (r) =>
    registerNotesHistory(r, resolveAccess(opts), opts.ownership, opts.parents),
  );
}
