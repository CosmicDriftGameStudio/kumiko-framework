---
"@cosmicdrift/kumiko-bundled-features": minor
---

GDPR default mails are notifications with seeded templates

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: GDPR default mails are r.notification declarations, render*Email is gone
detail: export-ready, export-failed, deletion-requested and deletion-executed are declared as trigger-less notifications (user-data-rights:notify:<name>) with variables and localized templates built from the GDPR translations, so a tenant can override the text. The default export-ready, export-failed and deletion-requested mails send through ctx.notify to the user (export mails with immediate so the plain magic-link token never lands in a job payload). deletion-executed renders the seeded template through the mail renderer and sends over the tenant mail transport without a delivery log, because the user is already gone. App-provided send*Email callbacks still win. The defaults now need delivery with channel-email; a boot warning is logged once when mail-foundation and a mail transport are mounted without them. New exports are GdprMailNotificationTypes, gdprMailLocalizedTemplate, gdprMailTemplateLocale, registerGdprMails and formatGdprMailTimestamp.
migration: |
  renderExportReadyEmail, renderExportFailedEmail, renderDeletionRequestedEmail, renderDeletionExecutedEmail and RenderedEmail are removed from user-data-rights/email-templates; the translations stay. An app that mounts it without includeBundled needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html at boot (composeRendererStack() from dev-server mounts all of them), plus a delivery with the channel-email feature; apps without the template tables need a schema migration (`kumiko schema generate`). Delivery preferences that referenced the mails use the new user-data-rights:notify:<name> types.
-->
