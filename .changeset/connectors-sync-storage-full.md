---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The connector list says why a satellite is not syncing when its upload was refused for lack of storage; the pairing link a satellite shows opens the pair screen in an app with workspaces.

<!-- kumiko-changes
feature: connectors
type: improvement
title: The connector list shows "Storage full, uploads paused"
detail: When an upload is refused with `507 storage_quota_exceeded`, the device remembers it (`quotaRejectedAt`) and the "Details" column of its connector says "Storage full, uploads paused" until the next upload of that device is accepted. The server decides this, so no satellite update is needed. New column on `store_connector_devices`: run the migration `0073_connectors-quota-rejected`.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: A link to a screen without workspace prefix opens that screen
detail: In an app with workspaces, `/<screenId>` (for example the connectors pairing link `/connector-pair`) was read as an unknown workspace and ended on the default screen. The shell now moves it to the active workspace and keeps the query.
-->
