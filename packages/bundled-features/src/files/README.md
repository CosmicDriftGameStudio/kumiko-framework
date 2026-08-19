# files

Schema-Sicht der framework-internen `file_refs`-Tabelle als bundled-feature.
Sprint-1.5 Refactor (Pre-Sprint-2).

## Was es macht

Deklariert `r.entity("fileRef", ...)` für die DB-Tabelle die das
Framework via `createFileRoutes` (multipart-Upload + binary-Download)
bewirtschaftet. Das öffnet die Tür für Cross-Feature-Hooks:

- **Sprint 2** (`user-data-rights-defaults`) registriert `r.useExtension(EXT_USER_DATA, "fileRef", { export, delete })` — Forget-Flow + Daten-Export fassen die Files automatisch an. ✅ done
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
fileName     → personal: "self", find: "none"  (Originalname enthält oft Personen-Bezug)
storageKey   → kein PII-Marker (interner UUID-Key, trifft die Heuristik nicht)
mimeType     → kein PII-Marker
size         → kein PII-Marker
entityType   → kein PII-Marker
entityId     → kein PII-Marker
fieldName    → kein PII-Marker
insertedAt   → kein PII-Marker (Audit-Timestamp, Framework-managed Base-Column)
insertedById → kein PII-Marker (User-Reference, Framework-managed Base-Column, kein Eigen-PII)
```

`fileName: personal: "self"` heißt: Sprint 3 Crypto-Shredding verschlüsselt den
Wert mit dem Author-Subject-Key (für File-INHALTE: separates
Subject-Resolver-Pattern via `subjectField` — siehe storage-encryption.md
Sprint 4).

## Tests

`__tests__/files.integration.test.ts` — 5 Tests die beweisen dass die Feature-
Definition clean lädt + die PII-Markers + Tabellenname stimmen.
