---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Template preview and test mail

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Preview query and send-test write for mail and PDF templates
detail: template-resolver:query:preview renders a draft, or the stored template when no content is given, with sample values from the declared variable examples (list variables get two rows). The draft passes the same write gates as a save and a mail goes through the real mail renderer, so subject, html, plain text and inline images match a real send. The response carries checks (images resolved, plain text present, size under 10 MiB, required placeholders used); a PDF template returns its sanitized body and the layout regions. template-resolver:write:send-test mails the rendered mail to the calling user's own address only, subject prefixed with [TEST], limited to 10 per user and hour. It needs delivery, channel-email and renderer-mail-html.
-->

<!-- kumiko-changes
feature: delivery
type: improvement
title: EMAIL_CHANNEL_NAME, createTemplateMailRenderer and createEmailAttachmentReader are exported
detail: The email channel name is a shared constant instead of a string literal. The mail renderer and the inline-attachment reader that build the channel context are exported and accept a tenant-bound db, so a handler can send through the same path as a notification.
-->

<!-- kumiko-changes
feature: renderer-foundation
type: improvement
title: MailPayload.draft renders an unsaved mail template; RendererContext.db also accepts a TenantDb
detail: MailDraft (content, meta, variableSchema) replaces the stored body and subject of the template with the payload's slug and keeps its stored images; a slug without a stored template renders as a tenant draft. The renderer sanitizes the draft body and validates its meta again, and the response carries no template provenance. RendererContext.db is widened from DbConnection to DbRunner | TenantDb.
-->

<!-- kumiko-changes
feature: renderer-mail-html
type: improvement
title: Renders a MailPayload.draft instead of the stored template body and subject
detail: With a draft the stored template of the slug only supplies its linked images and variable schema; the body goes through the document sanitizer and the meta through the mail meta check, and a violation is an invalid_payload error. The response has no template reference because a draft is not a stored version.
-->
