---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Mail template editor building blocks: file attachments, system copy-locale, display preview, labelled chips

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Mail templates carry file attachments (PDF, PNG, JPEG)
detail: linkedResources stays image only; file attachments of a mail template are listed in the optional TemplateResource.fileAttachments (kind file, fileRefId, fileName), sorted by key. template-resolver:write:resource-upload takes purpose "attachment" with a fileName; it checks the file by content (PDF, PNG, JPEG), keeps the original bytes, allows at most 10 per mail template and stores the entry next to the inline images. resource-remove, copy-locale and the bundle export/import carry attachments (bundle resource entries get purpose "attachment"). The preview lists attachments with kind "inline" or "file" (PreviewAttachment is now a union), send-test sends them, and the mail renderer attaches them after the inline images within the delivery attachment limit.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: copy-locale can copy system templates (scope "system", system admins only)
detail: template-resolver:write:copy-locale takes scope "tenant" (default) or "system". With "system" a system admin copies a system template to another locale as a draft; other callers get access denied.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Mail preview returns displayHtml for the editor
detail: The preview of a mail template carries displayHtml, the body with cid images replaced by data URIs (png, jpeg, gif, webp, 5 MiB budget in total) so an editor can show it without cid support. The sent mail is unchanged.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Document editor gets variable labels, a handle, resource previews, canvas chrome, underline and PlaceholderLineEditor
detail: DocumentContentEditor accepts variableLabels, systemVariables, resourcePreviews, chrome ("default" or "canvas") and onEditorReady (handle with insertPlaceholder, insertResource, focus). The new PlaceholderLineEditor edits plain text with {{name}} placeholders as chips on one line. Underline (u) is part of the document schema and survives the sanitizer.
-->

<!-- kumiko-changes
feature: delivery
type: improvement
title: ChannelContext.readAttachment takes an attachment origin
detail: readAttachment(ref, origin) with origin "template" (from the renderer) or "message" (default, from notify data). Only template attachments may fall back to the system tenant; file refs from notify data stay limited to the sending tenant.
-->
