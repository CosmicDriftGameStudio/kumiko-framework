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
// `body` is about the HOST entity (entityType/entityId), not the author — the
// author is never the data subject of a note's content, so it is deliberately
// NOT `personal: { of: "authorId" }`. That axis would crypto-shred every
// note's content the moment its author's data-rights key is destroyed (an
// employee leaving triggers a forget), garbling unrelated business notes
// about customers/projects/etc. — data loss, not privacy.
//
// `body` is instead `personal: { of: "id" }` (Row-Subject, fw#2596/#2786):
// the note's OWN row is its content's subject, so `body` is encrypted under a
// per-note key that nothing else shares. That key gets erased only when
// `note-mention` (below) names this note as reached by a forgotten subject
// (see `notes-history-user-data/hooks.ts`) — a note with no mention on the
// forgotten subject is untouched. GDPR erasure of the AUTHOR still separately
// shreds `authorName` (`personal: { of: "authorId" }`, the name as stamped at
// write time); the two erasures are independent.
//
// Known gap (fw#2596, not fixed by this entity): prose that names a third
// party without a structured @-mention is not tracked — regex/NLP over
// free text is unreliable. The operator's manual `forget-subject` path
// covers what this structured trigger misses.
export function createNoteEntryEntity(access?: EntityDefinition["access"]) {
  return createEntity({
    table: "read_note_entries",
    description:
      "One note attached to a host entity by entityType and entityId, holding the note body plus the id and the display name of the author as it stood when the note was written. Rows are append-only: a correction is a further note, never an edit of this one.",
    access,
    fields: {
      entityType: createTextField({ required: true, maxLength: 64 }),
      // Host entity ids are uuid/text; 128 covers uuid plus non-uuid text keys.
      entityId: createTextField({ required: true, maxLength: 128 }),
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
        // Row-Subject (fw#2596/#2786): the note itself is the subject, so its
        // key is erased per-note via `note-mention` lookups, not tied to any
        // user's own forget.
        personal: { of: "id" },
        find: "none",
      }),
    },
  });
}

export const noteEntryEntity = createNoteEntryEntity();

// note-mention — join row recording that a note names a subject via a
// structured @-mention in the editor (never parsed out of `body` text — see
// the header comment above). One row per (note, mentioned subject); a note
// with several mentions gets several rows.
//
// `subjectId` is the plain FK to the mentioned user's id — `personal: "ref"`
// marks it as a subject reference for the GDPR-hook-coverage boot guard
// (same role as `authorId` on note-entry above), not itself encrypted.
// `notes-history-user-data/hooks.ts` looks this table up by `subjectId` when
// a user is forgotten, to find every note whose row-subject key must be
// erased; see that file for the cascade and the retention-consult step it
// runs first.
export function createNoteMentionEntity() {
  return createEntity({
    table: "read_note_mentions",
    description:
      "One row recording that a note names a subject via a structured @-mention, keyed by noteId and the mentioned subject's id.",
    fields: {
      noteId: createTextField({ required: true, maxLength: 64 }),
      subjectId: createTextField({ required: true, maxLength: 64, personal: "ref" }),
    },
  });
}

export const noteMentionEntity = createNoteMentionEntity();
