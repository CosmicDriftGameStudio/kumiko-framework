---
"@cosmicdrift/kumiko-bundled-features": minor
---

Remove renderer-simple, MailBranding and the renderer kind notification

<!-- kumiko-changes
feature: renderer-foundation
type: breaking
title: renderer-simple, MailBranding and renderer kind "notification" are removed
detail: Every mail is a stored template rendered by renderer-mail-html now. renderer-simple (createRendererSimpleFeature, simpleRenderer, createSimpleRenderer, RendererSimpleOptions, mail blocks with LocalizedText, MailBadge, MailChip, MailStage, MailStageState and MailTone), the MailBranding type, the renderer kind "notification" and AuthMailContent are gone. NotificationRenderer and RendererInput are removed from delivery, and createChannelEmailFeature no longer takes a renderer option. The type NotificationPayload is removed from renderer-foundation. The template-resolver keeps "notification" only as a stored kind so legacy rows stay readable; RENDER_KINDS is mail, document-pdf and image-snapshot.
migration: |
  Remove createRendererSimpleFeature() and any renderer or mailBranding option from your feature list and createChannelEmailFeature call. An r.notification that is sent by email needs template + meta (or localizedTemplate) and variables; the sections/header/footer data it carried is replaced by template variables. Branding (logo, footer) now comes from the tenant branding config and the mail layout of renderer-mail-html. Mount template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html (composeRendererStack() mounts all of them) and run seedNotificationTemplates at boot. Existing template rows with kind "notification" are no longer rendered; re-create them as kind "mail" or archive them.
-->
