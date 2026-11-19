---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The connector list says why a satellite is not syncing when the tenant's storage is full.

<!-- kumiko-changes
feature: connectors
type: improvement
title: The connector list shows "Storage full, uploads paused"
detail: When the tenant's stored bytes reach `maxStoredBytesPerTenant`, the "Details" column of every connector that is not idle says "Storage full, uploads paused" instead of staying empty. The server decides this, so no satellite update is needed.
-->
