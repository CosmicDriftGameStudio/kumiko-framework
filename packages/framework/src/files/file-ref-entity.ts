import { createEntity, createNumberField, createTextField, createTimestampField } from "../engine";

// fileRef — das File-Metadata-Entity. Ganz normales ES-Entity: Upload/Delete
// laufen über den Standard-Executor (file-routes.ts), die Tabelle `file_refs`
// wird via buildEntityTable aus dieser Definition gebaut.
//
// softDelete: true — wie das `user`-Entity + die data-retention-Strategien.
// Ein Delete markiert `isDeleted=true` (wiederherstellbar, kein "sofort weg");
// echtes Erasure (Art. 17) läuft über den Forget-Hook + Retention-Cleanup.
//
// PII-Annotations:
//   - fileName → pii: true (Originalname enthält oft Personen-Bezug:
//     "Marc-Lebenslauf.pdf", "Krankheitsattest-Mai.pdf"). Andere Felder
//     (storageKey, mimeType, size, entityType, entityId, fieldName,
//     insertedById, insertedAt) treffen die PII-Heuristik nicht.
export const fileRefEntity = createEntity({
  table: "file_refs",
  softDelete: true,
  fields: {
    storageKey: createTextField({ required: true }),
    fileName: createTextField({ required: true, pii: true }),
    mimeType: createTextField({ required: true }),
    size: createNumberField({ required: true }),
    entityType: createTextField(),
    entityId: createTextField(),
    fieldName: createTextField(),
    insertedAt: createTimestampField({ sortable: true, filterable: true }),
    insertedById: createTextField(),
  },
});
