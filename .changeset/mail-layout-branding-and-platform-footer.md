---
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Mails carry the tenant logo, the accent colour and a platform footer a tenant layout cannot remove

<!-- kumiko-changes
feature: renderer-mail-html
type: improvement
title: createRendererMailHtmlFeature takes a footer resolver for imprint, privacy and platform line
detail: createRendererMailHtmlFeature({ footer }) resolves a footer per mail from locale and renderer context: an optional text line plus imprint and privacy links. The renderer appends it below every layout, the in-code one, mjml layouts and structured tenant layouts, so a tenant cannot edit or delete it. Values are escaped and only http(s) and mailto links are kept. The imprint URL also fills the {{imprint}} system placeholder, and a layout region that already links {{imprint}} or {{unsubscribeUrl}} is not doubled. The unsubscribe link is labelled in the mail language (de, en, es, English otherwise). Without a resolver only the unsubscribe link is added, as before.
-->

<!-- kumiko-changes
feature: renderer-mail-html
type: improvement
title: Without a stored layout mails use the tenant branding logo and accent colour
detail: When no tenant or system layout exists, the renderer no longer falls back to a bare MJML frame. It renders the structured frame with the branding logo in the header (or the tenant name when no logo is set), the accent line and buttons in the branding accent colour, and the platform footer. Layout HTML now carries lang from the mail locale instead of lang="und".
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: A paragraph or heading that only holds an empty placeholder is left out of the rendered document
detail: compileDocumentBodyToHandlebars wraps a p or h1 to h4 whose only content is one placeholder in an if block, so an empty optional value no longer leaves a blank line in mails and PDFs. Zero numbers and money values still render. Blocks with static text, images or several placeholders are unchanged.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Mail layout buttons follow the branding accent colour
detail: mailLayoutAppearance takes the tenant branding accent colour. When the layout uses the branding accent line, buttons in the mail body use that colour instead of the fixed dark teal. Invalid colours fall back to the previous default.
-->

<!-- kumiko-changes
feature: channel-email
type: fix
title: List-Unsubscribe accepts an app-owned unsubscribe URL
detail: When unsubscribeUrl in the mail data points to an http(s) URL outside the framework unsubscribe route, the email channel sets List-Unsubscribe to that URL without the one-click List-Unsubscribe-Post header, because the framework cannot vouch for a foreign endpoint accepting POST. Other schemes set no header.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: composeRendererStack passes a mail footer resolver to the mail renderer
detail: composeRendererStack({ mailFooter }) hands the resolver to createRendererMailHtmlFeature, so apps on the composed stack set imprint, privacy and platform line in one place.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: A placeholder inside a button label is kept
detail: The document schema allows placeholder chips inside a button label. Before, saving or seeding a body such as a button reading "View {{pageName}}" split the button: the label stopped at the placeholder and the rest landed in a new paragraph outside the button.
-->
