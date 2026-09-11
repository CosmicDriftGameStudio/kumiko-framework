import {
  createEntity,
  createLongTextField,
  createTextField,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

// note-entry — host-agnostic, append-only note attached to ANY entity via
// (entityType, entityId), same join-row pattern as tags/tag-assignment: no
// column on the host entity, cross-entity reads compose in the read-layer by
// filtering on entityId. Unlike tags there is no deterministic aggregate-id —
// an entity can carry many notes, so every create() is a fresh random-id
// stream (no idempotency requirement, no restore/version_conflict handling).
//
// Strictly append-only by design: no update/delete write-handler is
// registered (see feature.ts). A correction is a new entry, not an edit —
// that is the whole point of a note *history* instead of the single
// overwritable textarea this bundle replaces (solon#13).
//
// `body` is about the HOST entity (entityType/entityId), not the author —
// the author is never the data subject of a note's content, so it is
// deliberately NOT `personal: { of: "authorId" }`. That axis would
// crypto-shred every note's content the moment its author's data-rights key
// is destroyed (an employee leaving triggers a forget), garbling unrelated
// business notes about customers/projects/etc. — data loss, not privacy.
// `body` stays plaintext (`personal: false`), same call as tags' catalog
// `name` field. GDPR erasure of the AUTHOR still shreds `authorName`
// (`personal: { of: "authorId" }`, the name as stamped at write time) —
// `body` and the note itself are unaffected. If a note's body incidentally
// names or describes a third party, that isn't tracked by field annotation
// today; no PII hooks exist for note content.
export function createNoteEntryEntity(access?: EntityDefinition["access"]) {
  return createEntity({
    table: "read_note_entries",
    description:
      "One note attached to a host entity by entityType and entityId, holding the note body plus the id and the display name of the author as it stood when the note was written. Rows are append-only: a correction is a further note, never an edit of this one.",
    access,
    fields: {
      entityType: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      // Host entity ids are uuid/text; 128 covers uuid plus non-uuid text keys.
      entityId: createTextField({
        required: true,
        maxLength: 128,
        personal: false,
        reason: "technical_reference",
      }),
      // Never client-supplied — stamped by the deriveAuthorId preSave hook from
      // ctx.user.id (see feature.ts), so a note can't be authored as someone
      // else. subjectRef feeds the GDPR-hook-coverage boot guard (it's a plain
      // FK into `user`, not content of its own).
      authorId: createTextField({
        personal: "ref",
      }),
      // Stamped once at write time, never re-resolved later — the history
      // needs the name as it was then, not whatever the account is called now.
      authorName: createTextField({
        maxLength: 200,
        personal: { of: "authorId" },
        find: "none",
      }),
      body: createLongTextField({
        required: true,
        maxLength: 20_000,
        // Describes the host entity, not the author — no per-user subject to
        // crypto-shred against. `personal: false` silences the
        // user-content-name heuristic (`body` is on PII_USER_OWNED_NAME_HINTS).
        personal: false,
        reason: "note_content_not_owned_by_author",
      }),
    },
  });
}

export const noteEntryEntity = createNoteEntryEntity();
