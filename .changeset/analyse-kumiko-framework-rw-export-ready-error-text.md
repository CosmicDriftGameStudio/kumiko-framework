---
"@cosmicdrift/kumiko-bundled-features": patch
---

The configuration error for `sendExportReadyEmail` without `appExportDownloadUrl` is now English.

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: sendExportReadyEmail configuration error in English
detail: Setting `sendExportReadyEmail` without `appExportDownloadUrl` still fails, now with the English message "user-data-rights: sendExportReadyEmail is set but appExportDownloadUrl is missing, configure both together" instead of the German one. Code that matched the German text must match the new one.
-->
