# PDF Audit Export

A write handler exports tenant data as a PDF and keeps it as a FileRef.

## What it shows

- `renderTablePdf` (`@cosmicdrift/kumiko-bundled-features/renderer-pdf`) draws a table document in pure JavaScript: repeating header, weighted columns, page footer. The handler passes ready-formatted strings.
- The export is a `beforeTransaction` handler: it reads the rows (reads work in that phase), renders the PDF and calls `uploadFileBytesBeforeTransaction` (`@cosmicdrift/kumiko-framework/files`), which validates the bytes and writes them to the tenant-prefixed storage key. The upload runs before the transaction because storage I/O inside it would hold a pool connection for as long as the upload takes.
- The handler itself calls `createFileRefFromUploadedBytes(ctx, event.prepared)` and creates the `file_refs` row and the `fileRef.created` event in the transaction. If the transaction does not commit, the phase's `release` deletes the uploaded bytes again (only when no row exists for the storage key). A crash between upload and commit leaves the bytes in storage; the hourly `files:job:sweep-orphaned-uploads` job deletes them once they are older than the grace period (24 hours by default, `uploadSweepGraceHours`).
- The result is a normal FileRef: `GET /api/files/:id` serves it with `Content-Type: application/pdf`, other tenants get 404.

## Source

Feature entry point: `src/feature.ts`. The export reads at most 200 inspections per call.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/pdf-audit-export
bun test
```
