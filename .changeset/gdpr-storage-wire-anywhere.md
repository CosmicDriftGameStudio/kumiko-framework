---
"@cosmicdrift/kumiko-bundled-features": minor
---

GDPR/DSGVO storage is now wire-into-any-app-clean: an app gets a working,
restart-surviving export + autonomous erasure by mounting + configuring, with a
boot guard that catches the misconfiguration we shipped to prod (ephemeral
export store → download 500 after a pod restart).

- **`file-provider-s3-env` (new bundled feature)** — registers an `"s3-env"`
  file provider that reads one S3 credential set from `process.env`
  (`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, optional
  `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`) and serves every tenant from one shared
  bucket — no per-tenant config or secret seeding. The single-bucket /
  Hetzner-Object-Storage deploy path. Use `file-provider-s3` instead when each
  tenant needs its own bucket. Tenant isolation holds via tenant-prefixed
  export keys + UUID fileRef keys.
- **Autonomous Art. 17 forget-cron** — `user-data-rights` now schedules
  `run-forget-cleanup` as a cron (mirroring the export cron). Deletion requests
  no longer sit in `DeletionRequested` forever; erasure runs unattended after
  the grace period. The manual `runForget` API stays for operator runs.
- **Forget binary-delete resolves through file-foundation** — the `fileRef`
  delete hook now resolves the storage provider per-tenant from the mounted
  file-foundation at run time (injected via `ctx.buildStorageProvider`), the
  same path the export cron uses — so erasure deletes binaries from the same
  store uploads/export use (delete-target == upload-target by construction).
  **BREAKING:** `createUserDataRightsDefaultsFeature` no longer takes a
  `{ storageProvider }` option, and `createFileRefDeleteHook` is removed. Mount
  file-foundation + a `file-provider-*` feature instead; the hook wires itself.
- **V1 boot guard** — `validateBoot` now WARNs when `user-data-rights` is
  mounted but no persistent file provider is (GDPR exports would be lost on
  restart), and when `s3-env` is the sole GDPR store but its `S3_*` env vars
  are unset (the provider would otherwise throw lazily on the first export).
