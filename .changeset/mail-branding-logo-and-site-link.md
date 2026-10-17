---
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Mail header shows the branding logo address, band link falls back to an app site URL

<!-- kumiko-changes
feature: renderer-mail-html
type: improvement
title: Mail header shows the branding logo address, band link falls back to an app site URL
detail: Without an uploaded logo file the mail renderer now uses the https address from branding.logoUrl for the layout brand row (28 px high) and for a logo image in the body; the mail client loads it, the PDF renderer never does. New option siteUrl on createRendererMailHtmlFeature (type MailSiteUrlResolver) supplies the site link of the footer band when the tenant has no branding.siteUrl. Without either value the band shows only the unsubscribe link, never an empty link.
-->
