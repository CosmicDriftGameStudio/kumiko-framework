---
"@cosmicdrift/kumiko-framework": minor
---

Unify file-storage wiring through file-foundation (#608)

Uploads, `ctx.files` and the GDPR export/forget jobs now resolve the
`FileStorageProvider` per-tenant through a single source — file-foundation — so
they always hit the same store by construction. This closes a correctness trap
where an app could wire upload storage to one bucket while Art. 17/20
erasure/export resolved another, making erasure report "done" while bytes
survived and export return empty.

- **BREAKING**: `buildServer({ files: { storageProvider } })` and the API
  entrypoint's `files` option are removed. Mount `file-foundation` + a
  `file-provider-*` feature (`inmemory`/`s3`/`s3-env`) and select one per tenant
  via the `file-foundation:config:provider` config key. Upload-route policy
  (`accessGuard`/`privilegedRoles`/`maxUploadSize`) moves to
  `createFilesFeature(opts?)`. The `/api/files` routes mount automatically when
  the registry declares file/image fields and a provider plugin is mounted.
- **BREAKING**: `createFileContext(provider)` is now
  `createFileContext(resolve)` (a tenant-bound provider thunk), and
  `createFileRoutes` takes `resolveProvider` instead of `storageProvider`.
- `createFileProviderForTenant` and the file-provider plugin types now live in
  `@cosmicdrift/kumiko-framework/files`;
  `@cosmicdrift/kumiko-bundled-features/file-foundation` re-exports them, so
  those imports are unchanged.
