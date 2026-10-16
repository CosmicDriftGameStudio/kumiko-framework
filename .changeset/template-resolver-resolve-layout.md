---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Layouts resolve across locales

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: resolveLayout finds a layout in any locale
detail: TemplateResolverApi gains resolveLayout({ tenantId, slug, kind, locale }) for mail-layout and pdf-layout. It looks at the tenant first (requested locale, then the fallback locale, then any active locale) and then at the system layouts the same way, ignoring draft and archived rows. A layout saved by the layout editor under one locale is therefore found for every locale. The template preview uses it for the PDF layout.
-->

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: Mails use a tenant layout stored under another locale
detail: The mail renderer resolves its layout with resolveLayout, so a tenant layout saved in en no longer leaves German mails without the tenant branding.
-->

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: PDFs use a tenant layout stored under another locale
detail: The document PDF renderer resolves its letterhead with resolveLayout, so a tenant pdf-layout saved under one locale applies to every document locale.
-->
