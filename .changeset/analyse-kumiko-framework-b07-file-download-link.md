---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Handlers can hand out signed download links for files.

<!-- kumiko-changes
feature: framework
type: feature
title: Signed file download links from handlers
detail: `ctx.services.fileDownloadLinks.issue(fileRefId, { expiresInSeconds? })` returns `{ path, expiresAt }` for a file of the caller's tenant (default 15 minutes, at most 60). `GET /api/files/link/:token` streams the file without a session; an invalid, expired or deleted link answers 404. The issuing handler is the access check, so issue links only for files the caller may read. Use it instead of returning file bytes as base64 in a handler result.
-->
