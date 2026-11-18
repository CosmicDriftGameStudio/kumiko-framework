---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Mails the platform sends itself can carry the app's title and accent color through the new `platformBrand` option of the mail renderer.

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: Platform mails carry the app brand through platformBrand
detail: `createRendererMailHtmlFeature({ platformBrand: { title, accentColor? } })` brands the mails of the system tenant, such as the account deletion confirmation, in the brand row, the initial tile, the buttons and the chrome that `readMailChrome` hands to pages like the unsubscribe page. Branding stored for the system tenant still wins, and mails of every other tenant never get the platform brand. An empty title or an accent color that is not a `#rrggbb` hex is refused when the feature is created. Apps that build the renderer through `composeRendererStack` pass the brand as `composeRendererStack({ mailPlatformBrand })`. Before, the system tenant's mails showed no title and the default accent, because the renderer only knew tenant branding and `createConfigResolver({ appOverrides })` would have branded every tenant.
-->
