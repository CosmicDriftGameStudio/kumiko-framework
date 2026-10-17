---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template attachments and inline images no longer overwrite each other's key, and linked PDF templates must be active

<!-- kumiko-changes
feature: template-resolver
type: fix
title: resource-upload refuses key collisions between images and attachments and linking a non-active PDF template
detail: Uploading an attachment under a key that holds an inline image, or an image under a key that holds an attachment or linked PDF, fails with template_attachment_invalid (code key_in_use) instead of silently replacing the entry. resource-link-pdf only accepts an active document-pdf template, so draft or archived templates no longer produce mails that fail at send time. When the link write fails after the file was stored, the orphaned storage object is deleted.
-->
