# files

Schema-Sicht der framework-internen `file_refs`-Tabelle als bundled-feature.
Sprint-1.5 Refactor (Pre-Sprint-2).

## Was es macht

Deklariert `r.entity("fileRef", ...)` für die DB-Tabelle die das
Framework via `createFileRoutes` (multipart-Upload + binary-Download)
bewirtschaftet. Das öffnet die Tür für Cross-Feature-Hooks:

- **Sprint 2** (`user-data-rights`) wird `r.useExtension(EXT_USER_DATA, "fileRef", { export, delete })` registrieren — Forget-Flow + Daten-Export fassen die Files automatisch an.
- **Sprint 5** (`tenant-lifecycle`) wird `r.useExtension(EXT_TENANT_DATA, "fileRef", { destroy })` registrieren — Tenant-Destroy löscht alle FileRefs.

## Was es NICHT macht

- **Keine Upload-/Download-Routes** — die bleiben in
  `framework/src/api/server.ts` via `options.files`-Bootstrap.
  Multipart-Form-Body und Binary-Streaming passen nicht ins Write/Query-
  Handler-Pattern; ein Refactor zu `r.httpRoute` wäre orthogonal zu
  diesem Sprint.
- **Kein eigener Drizzle-Table-Build** — die `file_refs`-Tabelle
  existiert schon in `framework/src/files/file-ref-table.ts`. Diese
  Entity ist nur die Schema-Sicht für Cross-Feature-Hooks; Drizzle-
  Queries laufen weiter über `fileRefsTable` aus
  `@cosmicdrift/kumiko-framework/files`.

## PII-Annotations (Sprint 0.1+0.7)

```ts
fileName    → pii: true                  (Originalname enthält oft Personen-Bezug)
storageKey  → allowPlaintext: "is-business-data"  (interner UUID-Key)
mimeType    → allowPlaintext: "is-business-data"
size        → allowPlaintext: "is-business-data"
entityType  → allowPlaintext: "is-business-data"
entityId    → allowPlaintext: "is-business-data"
fieldName   → allowPlaintext: "is-business-data"
insertedAt  → kein PII-Marker (Audit-Timestamp, Framework-managed)
insertedById → allowPlaintext: "is-business-data"  (User-Reference, kein Eigen-PII)
```

`fileName: pii: true` heißt: Sprint 3 Crypto-Shredding wird den Wert
mit dem Author-Subject-Key encrypten (für File-INHALTE: separates
Subject-Resolver-Pattern via `subjectField` — siehe storage-encryption.md
Sprint 4).

## Tests

`__tests__/files.integration.ts` — 5 Tests die beweisen dass die Feature-
Definition clean lädt + die PII-Markers + Tabellenname stimmen.
