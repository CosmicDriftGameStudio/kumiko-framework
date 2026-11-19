---
"@cosmicdrift/kumiko-bundled-features": minor
---

`template-resolver:write:resource-upload` requires `templateId` and `key`.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Resource upload always links into a template
detail: Without templateId the upload skipped the template edit check and only created a new file. That path had no caller; templateId and key are now required, so every upload runs the edit check of its template.
migration: Send templateId and key with every resource-upload call; a plain file goes through POST /api/files.
affects: resource-upload, resourceUpload
-->
