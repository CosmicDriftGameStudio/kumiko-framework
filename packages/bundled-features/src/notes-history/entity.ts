import {
  createEntity,
  createLongTextField,
  createTextField,
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
// overwritable textarea this bundle replaces (solon#13). GDPR erasure of the
// author still works without a delete path: `body` is `userOwned` (crypto-
// shredding on the author's subject key), not `pii` on the entity itself.
export const noteEntryEntity = createEntity({
  table: "read_note_entries",
  fields: {
    entityType: createTextField({ required: true, maxLength: 64 }),
    // Host entity ids are uuid/text; 128 covers uuid plus non-uuid text keys.
    entityId: createTextField({ required: true, maxLength: 128 }),
    // Never client-supplied — stamped by the deriveAuthorId preSave hook from
    // ctx.user.id (see feature.ts), so a note can't be authored as someone
    // else. subjectRef feeds the GDPR-hook-coverage boot guard (it's a plain
    // FK into `user`, not content of its own).
    authorId: createTextField({ subjectRef: true }),
    body: createLongTextField({
      required: true,
      maxLength: 20_000,
      userOwned: { ownerField: "authorId" },
    }),
  },
});
