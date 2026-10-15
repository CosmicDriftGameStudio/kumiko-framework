---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Template resources (images) and mail attachments

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: linkedResources is no longer a payload field of upsertSystem/upsertTenant; resourceUpload and resourceRemove manage it
detail: Two steps - upload the image with POST /api/files (multipart, no entityType), then call template-resolver:write:resource-upload with { sourceFileRefId, templateId?, key? }. The handler re-encodes the caller's own unclaimed upload into a new file ref (width at most 1200 px) and links it into the template; resource-remove unlinks a key. upsertSystem and upsertTenant no longer accept linkedResources and leave the stored value untouched on update. The size cap is the system config key resource-max-bytes (default 2 MiB); a cap above the files route's maxUploadSize has no effect because the upload is rejected first. The source upload stays as an unclaimed file.
migration: |
  Whoever sent linkedResources with upsertSystem or upsertTenant now uploads the image via POST /api/files (multipart, no entityType) and links it with template-resolver:write:resource-upload { sourceFileRefId, templateId, key }. Server-side seeding (seedSystemTemplate linkedResources) stays.
-->

<!-- kumiko-changes
feature: delivery
type: improvement
title: Notification messages carry attachments (file refs and inline cid images)
detail: RenderedMessage and the send job payload accept attachments as references (kind file or inline), never bytes. ChannelContext.readAttachment resolves them tenant-scoped at send time; createDeliveryService takes a new filesForTenant option for the inline fallback path.
-->

<!-- kumiko-changes
feature: channel-email
type: improvement
title: Email channel sends file attachments and inline cid images
detail: EmailMessage.attachments is sent through the SMTP transport (inline images with Content-ID). notify data.attachments with kind file entries are resolved through the file store; the PII guard rejects ciphertext file names.
-->

<!-- kumiko-changes
feature: delivery
type: improvement
title: NotifyFactory takes an optional fileProviderResolver, so immediate and bootstrap mails can read attachments too
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Bundle import re-encodes its images like resource-upload; re-seeding keeps uploaded system resources
detail: importBundle and importBundleSystem store each bundle resource through the same normalization as resource-upload (decoded format decides the content type, SVG and non-images are rejected, width at most 1200 px, resource-max-bytes applies), so an exported bundle carries the re-encoded bytes. seedSystemTemplate without linkedResources no longer resets the links of an existing row, so images a system admin uploaded survive the next boot. storeTemplateResource from the template-resolver barrel is the normalizing store; the raw byte variant is gone.
-->

<!-- kumiko-changes
feature: delivery
type: fix
title: Queued mails render with the tenant's config again
detail: The delivery render and send jobs read the tenant config through ctx.configFor, which job contexts do not carry, so queued mails rendered without tenant name, locale, currency and branding. Both jobs now use ctx.config, which the job runner builds for the payload's tenant.
-->
