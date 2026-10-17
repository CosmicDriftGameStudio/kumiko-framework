---
"@cosmicdrift/kumiko-renderer-web": minor
---

Download helpers for stored files

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Download helpers for stored files
detail: renderer-web exports downloadFileRef, fetchFileRefBlob, saveBlobAsFile and fileNameFromContentDisposition. downloadFileRef fetches a stored file through the CSRF-protected file endpoint and saves it under the server's file name, with an optional fallback name. saveBlobAsFile can prepend a UTF-8 BOM for CSV exports. A failed fetch throws FileDownloadFailedError with the HTTP status.
-->
