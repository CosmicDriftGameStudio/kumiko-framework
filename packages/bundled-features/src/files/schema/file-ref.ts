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
// Kein buildDrizzleTable hier — die Mapping-Tabelle existiert schon im
// Framework. Drizzle-Reads in den Sprint-2+-Hooks gehen direkt über
// `fileRefsTable` aus `@cosmicdrift/kumiko-framework/files`.
//
// PII-Annotations (Sprint 0.1+0.7):
//   - fileName        → pii: true (Originalname enthält oft Personen-
//                       bezug: "Marc-Lebenslauf.pdf", "Krankheitsattest-
//                       Mai.pdf")
//   - storageKey      → kein PII (interner UUID-Key)
//   - mimeType, size  → kein PII (binäre Metadata)
//   - entityType/Id/fieldName → kein PII (FK-Refs)
//   - insertedById    → kein PII (User-Reference, gehört dem User)
//   - insertedAt      → kein PII (Audit-Timestamp)
//
// Tabellenname matched die Framework-pgTable damit r.entity-Reads über
// dieselbe Postgres-Tabelle laufen.
export const fileRefEntity = createEntity({
  table: "file_refs",
  fields: {
    storageKey: createTextField({
      required: true,
      allowPlaintext: "is-business-data",
    }),
    fileName: createTextField({
      required: true,
      pii: true,
    }),
    mimeType: createTextField({
      required: true,
      allowPlaintext: "is-business-data",
    }),
    size: createNumberField({
      required: true,
      allowPlaintext: "is-business-data",
    }),
    entityType: createTextField({
      allowPlaintext: "is-business-data",
    }),
    entityId: createTextField({
      allowPlaintext: "is-business-data",
    }),
    fieldName: createTextField({
      allowPlaintext: "is-business-data",
    }),
    insertedAt: createTimestampField({
      sortable: true,
      filterable: true,
    }),
    insertedById: createTextField({
      allowPlaintext: "is-business-data",
    }),
  },
});
