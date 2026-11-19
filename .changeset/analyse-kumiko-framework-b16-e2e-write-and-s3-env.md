---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`waitForWrite` waits for one write type in e2e tests, and `defineAppE2eConfig` passes the local MinIO as `S3_*` to the app server.

<!-- kumiko-changes
feature: testing
type: improvement
title: waitForWrite and S3 env for e2e app servers
detail: `@cosmicdrift/kumiko-testing/e2e` exports `waitForWrite(page, writeType)`, which resolves with the `/api/write` response of that write type and fails with the response body when the status is 400 or higher, so a rejected write fails at the save instead of at a later visibility timeout. `defineAppE2eConfig` now also passes `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` and `S3_FORCE_PATH_STYLE=true` to the web server, derived from the resolved `MINIO_*` values with the same precedence (shell, then the app's `.env`, then the local default). The file provider is still chosen by `FILE_STORAGE_PROVIDER`. `managed-pages` exports `PAGE_UPDATE_HANDLER` for e2e tests.
migration: Apps that mapped `MINIO_*` to `S3_*` in their `playwright.config.ts` remove that mapping and keep only `FILE_STORAGE_PROVIDER`. Local copies of `waitForWrite` switch to the export.
-->
