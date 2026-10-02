---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Dashboard list columns accept `display: "datetime"`, which formats an ISO string or epoch-ms value in the user's locale and time zone. The admin-shell overview lists use it for `startedAt` and `failedAt` instead of showing raw ISO strings.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Dashboard list columns support display "datetime"; overview lists no longer show raw ISO timestamps
-->
