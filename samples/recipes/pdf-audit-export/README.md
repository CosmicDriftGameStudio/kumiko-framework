# PDF Audit Export

A write handler exports tenant data as a PDF and keeps it as a FileRef.

## What it shows

- `renderTablePdf` (`@cosmicdrift/kumiko-bundled-features/renderer-pdf`) draws a table document in pure JavaScript: repeating header, weighted columns, page footer. The handler passes ready-formatted strings.
- `createFileRefFromBytes` (`@cosmicdrift/kumiko-framework/files`) stores the bytes like an upload (validation, tenant-prefixed storage key, `fileRef.created` event); the tenant comes from the caller.
- The result is a normal FileRef: `GET /api/files/:id` serves it with `Content-Type: application/pdf`, other tenants get 404.

## Source

Feature entry point: `src/feature.ts`. The export reads at most 200 inspections per call.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/pdf-audit-export
bun test
```
