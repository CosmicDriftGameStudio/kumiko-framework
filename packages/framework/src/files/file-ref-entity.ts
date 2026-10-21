import { createBigIntField, createEntity, createTextField } from "../engine/index.ts";

// fileRef — the file-metadata entity. A standard ES entity: uploads/deletes
// run through the standard executor (file-routes.ts), and the `file_refs` table
// is built from this definition via buildEntityTable.
//
// softDelete: true — as with the `user` entity and the data-retention strategies.
// A delete sets `isDeleted=true` (recoverable, not "gone immediately"); actual
// erasure (Art. 17) runs through the Forget hook and retention cleanup.
//
// `insertedAt`/`insertedById` are framework-managed base columns (see
// buildBaseColumns in table-builder.ts) and must NOT be duplicated as entity
// fields — fieldColumns win during the merge, and the field variant without
// `.default(now()).notNull()` silently makes inserted_at nullable.
//
// PII annotations:
//   - fileName → personal: "self" (the original filename often carries a
//     personal reference: "Marc-Lebenslauf.pdf", "Krankheitsattest-Mai.pdf").
//     The other fields (storageKey, mimeType, entityType, entityId, fieldName)
//     are technical references or system metadata, not subject content.
export { FILE_REF_ENTITY_NAME } from "./types.ts";

export const fileRefEntity = createEntity({
  table: "file_refs",
  softDelete: true,
  fields: {
    storageKey: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    fileName: createTextField({ required: true, personal: "self", find: "none" }),
    mimeType: createTextField({ required: true, personal: false, reason: "system_metadata" }),
    size: createBigIntField({ required: true }),
    entityType: createTextField({ personal: false, reason: "technical_reference" }),
    entityId: createTextField({ personal: false, reason: "technical_reference" }),
    fieldName: createTextField({ personal: false, reason: "technical_reference" }),
  },
});
