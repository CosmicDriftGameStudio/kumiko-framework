import {
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// fileRef — Schema-Sicht der File-Metadata-Tabelle aus dem Framework.
//
// Architektur-Entscheidung (Sprint 1.5):
//
// Die DB-Tabelle `file_refs` lebt weiterhin in
// `framework/src/files/file-ref-table.ts` als drizzle pgTable, weil
// die Hono-Upload-/Download-Routes (`createFileRoutes` in
// `framework/src/api/server.ts`) sie direkt nutzen. Multipart-Upload
// und Binary-Streaming passen nicht in das Write/Query-Handler-Pattern
// — Routes bleiben framework-internal.
//
// Was hier passiert: dieselbe DB-Tabelle wird zusätzlich als
// `r.entity("fileRef")` in einem bundled-feature deklariert. Das
// ermoeglicht:
//   1. r.useExtension(EXT_USER_DATA, "fileRef", { export, delete })
//      in Sprint 2 — Forget-Flow + Daten-Export erkennen die Entity.
//   2. r.useExtension(EXT_TENANT_DATA, "fileRef", { destroy })
//      in Sprint 5 — Tenant-Lifecycle löscht alle FileRefs.
//   3. Boot-Validation für PII-Annotations greift (fileName, originalName).
//
// Kein buildEntityTable hier — die Mapping-Tabelle existiert schon im
// Framework. Drizzle-Reads in den Sprint-2+-Hooks gehen direkt über
// `fileRefsTable` aus `@cosmicdrift/kumiko-framework/files`.
//
// PII-Annotations (Sprint 0.1+0.7+1.7):
//   - fileName  → pii: true (Originalname enthält oft Personen-Bezug:
//                "Marc-Lebenslauf.pdf", "Krankheitsattest-Mai.pdf")
//
//   Andere Felder brauchen KEINE Annotation:
//   - storageKey, mimeType, size, entityType, entityId, fieldName,
//     insertedById → keine PII-typischen Field-Namen, PII-Heuristik
//     greift nicht (siehe boot-validator.ts PII_DIRECT_NAME_HINTS).
//     Ein allowPlaintext-Marker wäre Über-Annotation ohne Effekt.
//   - insertedAt → Audit-Timestamp, framework-managed.
//
// Tabellenname matched die Framework-pgTable damit r.entity-Reads über
// dieselbe Postgres-Tabelle laufen.
export const fileRefEntity = createEntity({
  table: "file_refs",
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
