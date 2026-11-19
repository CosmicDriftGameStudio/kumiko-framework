---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Uploads can opt out of the offsite backup with `backup: false`; connector uploads do, are capped per tenant and refuse system files; heartbeats carry a sync status and a retry signal.

<!-- kumiko-changes
feature: framework
type: improvement
title: File uploads can stay out of the offsite backup
detail: `createFileRefFromBytes` and `uploadFileBytesBeforeTransaction` take `backup: false`: the key is built under `nobackup/<tenantId>/` (`NO_BACKUP_STORAGE_PREFIX`, `buildNoBackupStorageKey`, `tenantNoBackupPrefix`, `isOwnUploadKey` are exported), `tenantStoragePrefixes()` includes it so tenant destroy deletes the files, and a backup mirror can exclude the one prefix. Without the option nothing changes.
-->

<!-- kumiko-changes
feature: connectors
type: improvement
title: Connector files stay out of the backup, are capped per tenant and refuse system files
detail: Delivered files are stored under `nobackup/<tenantId>/`. A tenant may store 5 GiB by default (`maxStoredBytesPerTenant` on `createConnectorsFeature`); beyond it an upload answers `507 storage_quota_exceeded` and stores nothing. Paths containing Windows or macOS system files (`Thumbs.db`, `$RECYCLE.BIN`, `desktop.ini`, `~$` lock files and others) answer `422 path_rejected`.
-->

<!-- kumiko-changes
feature: connectors
type: improvement
title: A satellite reports its sync status in the heartbeat and an admin can ask it to retry
detail: The heartbeat takes an optional `sync: { state, queued, failed, lastSyncAt? }`; the connector list shows it as a status badge with details, and a change of state or failure count is stored at once. The row action "Retry" (TenantAdmin) makes the next heartbeat answer carry `retry: true` exactly once. Old satellites without `sync` keep working.
-->

<!-- kumiko-changes
feature: connectors
type: feature
title: Delivered files form a folder tree with a "Dateien" screen
detail: The path's directory part becomes an event-sourced `inbound-folder` tree per device (`inbound-item.folderId`); folders hold counts and sizes over the whole subtree. The custom screen `connector-files` shows breadcrumb, folders and files with storage used against the quota, and deletes a file or a folder with its subtree and bytes (TenantAdmin; a folder is marked at once and the `delete-folder-tree` job removes the subtree in batches, any size). Apps mount `connectorsClient()` from `@cosmicdrift/kumiko-bundled-features/connectors/web`, place the screen in their nav and set the quota only on `createConnectorsFeature()`; the upload check and the screen share it. Paths deeper than 20 folders or with a segment over 255 characters answer `422 path_rejected`. New tables: run the migration `0072_connectors`.
-->

The connectors file tree can be searched by part of a name (`inbound-search`, server-side decrypt-and-scan with a cap of 20 000 names). A file re-sent while its folder is being deleted is kept in a fresh folder instead of being answered as a duplicate.
