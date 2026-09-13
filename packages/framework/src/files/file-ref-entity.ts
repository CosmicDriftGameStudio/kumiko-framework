import { createBigIntField, createEntity, createTextField } from "../engine";

// fileRef — das File-Metadata-Entity. Ganz normales ES-Entity: Upload/Delete
// laufen über den Standard-Executor (file-routes.ts), die Tabelle `file_refs`
// wird via buildEntityTable aus dieser Definition gebaut.
//
// softDelete: true — wie das `user`-Entity + die data-retention-Strategien.
// Ein Delete markiert `isDeleted=true` (wiederherstellbar, kein "sofort weg");
// echtes Erasure (Art. 17) läuft über den Forget-Hook + Retention-Cleanup.
//
// `insertedAt`/`insertedById` sind framework-managed base columns (siehe
// buildBaseColumns in table-builder.ts) und dürfen NICHT als Entity-Fields
// dupliziert werden — fieldColumns gewinnen beim Merge, und die Field-Variante
// ohne `.default(now()).notNull()` macht inserted_at still nullable.
//
// PII-Annotations:
//   - fileName → personal: "self" (original filename often carries a personal
//     reference: "Marc-Lebenslauf.pdf", "Krankheitsattest-Mai.pdf"). The other
//     fields (storageKey, mimeType, entityType, entityId, fieldName) are
//     technical references or system metadata, not subject content.
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
